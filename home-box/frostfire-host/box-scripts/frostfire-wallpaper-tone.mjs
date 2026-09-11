#!/exec-daemon/node

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readSync,
} from "node:fs";
import { pathToFileURL } from "node:url";

// Standard-time boundaries. Daylight-saving time shifts each one an hour later.
export const SAND_WALLPAPER_SCHEDULE = Object.freeze([
  Object.freeze({ tone: "b", startHour: 4 }),
  Object.freeze({ tone: "a", startHour: 8 }),
  Object.freeze({ tone: "b", startHour: 16 }),
  Object.freeze({ tone: "c", startHour: 20 }),
]);

export const FALLBACK_TIME_ZONE = "UTC";

export const MIN_SLEEP_SECONDS = 30;
export const MAX_SLEEP_SECONDS = 13 * 3600;

export function resolveWallpaperTone(localHour, daylightSaving = false) {
  const shift = daylightSaving ? 1 : 0;
  let selected = SAND_WALLPAPER_SCHEDULE[SAND_WALLPAPER_SCHEDULE.length - 1];
  for (const entry of SAND_WALLPAPER_SCHEDULE) {
    if (localHour >= entry.startHour + shift) selected = entry;
  }
  return selected.tone;
}

export function isSupportedTimeZone(timeZone) {
  if (typeof timeZone !== "string" || timeZone === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const UTC_EQUIVALENT_TIME_ZONE_IDS = new Set([
  "utc",
  "etc/utc",
  "gmt",
  "etc/gmt",
  "gmt0",
  "etc/gmt0",
  "gmt+0",
  "gmt-0",
  "etc/gmt+0",
  "etc/gmt-0",
  "greenwich",
  "etc/greenwich",
  "uct",
  "etc/uct",
  "universal",
  "etc/universal",
  "zulu",
  "etc/zulu",
]);

let ianaTimeZoneIds;

export function canonicalIanaTimeZone(timeZone) {
  if (typeof timeZone !== "string" || timeZone === "") return undefined;
  let canonical;
  try {
    canonical = new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions()
      .timeZone;
    if (ianaTimeZoneIds === undefined) {
      ianaTimeZoneIds = new Set(Intl.supportedValuesOf("timeZone"));
    }
  } catch {
    return undefined;
  }
  if (UTC_EQUIVALENT_TIME_ZONE_IDS.has(canonical.toLowerCase()))
    return undefined;
  return ianaTimeZoneIds.has(canonical) ? canonical : undefined;
}

// settings.json lives in box-owned durable storage, and start-desktop runs
// `sand-wallpaper paint` synchronously BEFORE x11vnc. A plain read there is a
// bringup hazard: with the sand_user_non_root gate off the read is root's, and
// a box-uid process can swap the file for a FIFO — or a symlink to one — whose
// open blocks until someone writes, so the desktop would never reach VNC.
//
// Opening O_NONBLOCK answers immediately for a FIFO or device, and fstat on the
// fd (not a pre-open stat, which would race the swap) then rejects anything
// that is not a regular file. The size cap keeps a merely enormous file from
// stalling the same path.
const MAX_SETTINGS_BYTES = 1024 * 1024;

function readRegularFileSync(path) {
  let fd;
  try {
    fd = openSync(path, fsConstants.O_RDONLY | fsConstants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_SETTINGS_BYTES) return undefined;
    const buffer = Buffer.allocUnsafe(stat.size);
    let filled = 0;
    while (filled < stat.size) {
      const read = readSync(fd, buffer, filled, stat.size - filled, filled);
      if (read <= 0) break;
      filled += read;
    }
    return buffer.subarray(0, filled).toString("utf8");
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

function readRawPersistedTimeZone(settingsPath) {
  let settings;
  try {
    settings = JSON.parse(readRegularFileSync(settingsPath) ?? "");
  } catch {
    return undefined;
  }
  const override = settings?.userTimeZoneOverride;
  return typeof override === "string" && override !== ""
    ? override
    : settings?.userTimeZone;
}

export function readPersistedTimeZone(settingsPath) {
  return canonicalIanaTimeZone(readRawPersistedTimeZone(settingsPath));
}

export function readEffectiveTimeZone(settingsPath) {
  const persisted = readRawPersistedTimeZone(settingsPath);
  return isSupportedTimeZone(persisted) ? persisted : FALLBACK_TIME_ZONE;
}

const zonePartsFormatterCache = new Map();

function zoneParts(timeZone, epochMs) {
  // hourCycle h23 so midnight reads as hour 0; `hour12: false` still yields 24
  // on some ICU builds.
  let formatter = zonePartsFormatterCache.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    zonePartsFormatterCache.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(epochMs));
  const read = (type) => Number(parts.find((part) => part.type === type).value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function zoneOffsetMs(timeZone, epochMs) {
  const parts = zoneParts(timeZone, epochMs);
  const asIfUTC = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asIfUTC - Math.floor(epochMs / 1000) * 1000;
}

const standardOffsetCache = new Map();

function standardOffsetMs(timeZone, year) {
  const key = `${timeZone}:${year}`;
  const cached = standardOffsetCache.get(key);
  if (cached !== undefined) return cached;
  // The lowest offset is the solar-time baseline, independent of hemisphere;
  // half-hour DST advances still compare greater than that baseline.
  let standard = Number.POSITIVE_INFINITY;
  for (let month = 0; month < 12; month++) {
    for (const day of [1, 15]) {
      standard = Math.min(
        standard,
        zoneOffsetMs(timeZone, Date.UTC(year, month, day, 12))
      );
    }
  }
  standardOffsetCache.set(key, standard);
  return standard;
}

function isDaylightSavingTime(timeZone, epochMs) {
  const { year } = zoneParts(timeZone, epochMs);
  return zoneOffsetMs(timeZone, epochMs) > standardOffsetMs(timeZone, year);
}

// Local wall time -> epoch. The offset depends on the instant we are solving
// for, so the first pass uses the offset at the naive guess and the second
// re-reads it at that instant; two passes converge for every real transition.
function wallClockToEpochMs(timeZone, { year, month, day, hour }) {
  const naive = Date.UTC(year, month - 1, day, hour);
  const firstPass = naive - zoneOffsetMs(timeZone, naive);
  return naive - zoneOffsetMs(timeZone, firstPass);
}

export function computeWallpaperPlan({ nowMs, timeZone }) {
  const zone = isSupportedTimeZone(timeZone) ? timeZone : FALLBACK_TIME_ZONE;
  const now = zoneParts(zone, nowMs);
  const daylightSaving = isDaylightSavingTime(zone, nowMs);
  let nextBoundaryMs = Number.POSITIVE_INFINITY;
  for (const dayOffset of [0, 1, 2]) {
    const date = new Date(
      Date.UTC(now.year, now.month - 1, now.day + dayOffset)
    );
    for (const { startHour } of SAND_WALLPAPER_SCHEDULE) {
      for (const shifted of [false, true]) {
        const hour = startHour + (shifted ? 1 : 0);
        const at = wallClockToEpochMs(zone, {
          year: date.getUTCFullYear(),
          month: date.getUTCMonth() + 1,
          day: date.getUTCDate(),
          hour,
        });
        const atLocal = zoneParts(zone, at);
        if (
          atLocal.year === date.getUTCFullYear() &&
          atLocal.month === date.getUTCMonth() + 1 &&
          atLocal.day === date.getUTCDate() &&
          atLocal.hour === hour &&
          isDaylightSavingTime(zone, at) === shifted &&
          at > nowMs &&
          at < nextBoundaryMs
        ) {
          nextBoundaryMs = at;
        }
      }
    }
  }
  const untilNext = Math.ceil((nextBoundaryMs - nowMs) / 1000);
  return {
    tone: resolveWallpaperTone(now.hour, daylightSaving),
    timeZone: zone,
    sleepSeconds: Math.min(
      MAX_SLEEP_SECONDS,
      Math.max(MIN_SLEEP_SECONDS, untilNext)
    ),
  };
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.argv[2] === "zone") {
    const zone = readPersistedTimeZone(process.argv[3]);
    if (zone === undefined) process.exit(1);
    process.stdout.write(`${zone}\n`);
  } else {
    const plan = computeWallpaperPlan({
      nowMs: Date.now(),
      timeZone: readEffectiveTimeZone(process.argv[2]),
    });
    process.stdout.write(`${plan.tone} ${plan.sleepSeconds}\n`);
  }
}
