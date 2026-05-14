export type AppStatus = {
  leagueClientConnected: boolean;
  champSelectActive: boolean;
  detectedChampion: string | null;
  detectedRole: "top" | "jungle" | "middle" | "bottom" | "utility" | null;
  autoApplyEnabled: boolean;
  databaseReady: boolean;
};
