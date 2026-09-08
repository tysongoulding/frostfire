import { create } from "zustand";

interface FtaStore {
  hoursSaved: number;
  blendedHourlyRate: number;
  userRating: number | null;
  calibrationHistory: Array<{
    timestamp: string;
    workstreamId: string;
    hours: number;
    rating: number;
  }>;
  recordCalibration: (workstreamId: string, rating: number, hours: number) => void;
  incrementHours: (delta: number) => void;
}

export const useFtaStore = create<FtaStore>((set) => ({
  hoursSaved: 0,
  blendedHourlyRate: 85.0, // Standard blended knowledge worker rate $/hr
  userRating: null,
  calibrationHistory: [],

  recordCalibration: (workstreamId, rating, hours) =>
    set((state) => ({
      userRating: rating,
      hoursSaved: state.hoursSaved + hours,
      calibrationHistory: [
        {
          timestamp: new Date().toLocaleTimeString(),
          workstreamId,
          hours,
          rating,
        },
        ...state.calibrationHistory,
      ],
    })),

  incrementHours: (delta) =>
    set((state) => ({
      hoursSaved: Math.round((state.hoursSaved + delta) * 10) / 10,
    })),
}));
