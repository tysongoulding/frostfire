import { useState, useEffect } from "react";

export interface WeatherData {
  tempF: number;
  tempC: number;
  condition: string;
  weatherCode: number;
  city: string;
  region: string;
  humidity: number;
  windMph: number;
  loading: boolean;
  error: string | null;
}

export function useWeather() {
  const [weather, setWeather] = useState<WeatherData>({
    tempF: 72,
    tempC: 22,
    condition: "Partly Cloudy",
    weatherCode: 2,
    city: "Salt Lake City",
    region: "Utah",
    humidity: 38,
    windMph: 8,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let isMounted = true;

    async function fetchIpWeather() {
      try {
        // Step 1: Geolocation by IP
        const geoRes = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(4000) });
        if (!geoRes.ok) throw new Error("Geo lookup failed");
        const geo = await geoRes.json();
        const lat = geo.latitude || 40.7608;
        const lon = geo.longitude || -111.891;
        const city = geo.city || "Salt Lake City";
        const region = geo.region || geo.country_name || "Utah";

        // Step 2: Open-Meteo Current Weather
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&hourly=relativehumidity_2m`;
        const weatherRes = await fetch(weatherUrl, { signal: AbortSignal.timeout(4000) });
        if (!weatherRes.ok) throw new Error("Weather forecast failed");
        const weatherData = await weatherRes.json();

        const current = weatherData.current_weather;
        const tempC = Math.round(current.temperature);
        const tempF = Math.round((tempC * 9) / 5 + 32);
        const weatherCode = current.weathercode;

        // Interpret WMO Weather code
        let condition = "Clear";
        if (weatherCode === 0) condition = "Sunny";
        else if (weatherCode === 1 || weatherCode === 2) condition = "Partly Cloudy";
        else if (weatherCode === 3) condition = "Overcast";
        else if ([45, 48].includes(weatherCode)) condition = "Foggy";
        else if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(weatherCode)) condition = "Rainy";
        else if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) condition = "Snowy";
        else if ([95, 96, 99].includes(weatherCode)) condition = "Thunderstorm";

        const humidity = weatherData.hourly?.relativehumidity_2m?.[0] || 42;
        const windMph = Math.round((current.windspeed || 10) * 0.621371);

        if (isMounted) {
          setWeather({
            tempF,
            tempC,
            condition,
            weatherCode,
            city,
            region,
            humidity,
            windMph,
            loading: false,
            error: null,
          });
        }
      } catch (err: unknown) {
        if (isMounted) {
          // Graceful fallback defaults
          setWeather((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : "Fallback weather",
          }));
        }
      }
    }

    fetchIpWeather();

    return () => {
      isMounted = false;
    };
  }, []);

  return weather;
}
