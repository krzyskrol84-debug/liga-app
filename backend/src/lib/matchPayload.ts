import type { MatchDto, MatchParticipantDto } from "../riot/RiotApiClient.js";

export type StoredParticipant = {
  championId?: number;
  teamId?: number;
  teamPosition?: string;
  individualPosition?: string;
  opponentChampionId?: number;
  win?: boolean;
  summoner1Id?: number;
  summoner2Id?: number;
  perks?: MatchParticipantDto["perks"];
  item0?: number;
  item1?: number;
  item2?: number;
  item3?: number;
  item4?: number;
  item5?: number;
};

export type NormalizedStoredMatchPayload = {
  matchId?: string;
  patch?: string;
  info?: {
    gameVersion?: string;
    participants?: StoredParticipant[];
  };
};

type CompactMatchPayload = {
  matchId: string;
  patch: string | null;
  participants: StoredParticipant[];
};

export function buildCompactMatchPayload(matchId: string, match: MatchDto): CompactMatchPayload {
  const participants = (match.info?.participants ?? []).map((participant) =>
    compactParticipant(participant, match.info?.participants ?? []),
  );

  return {
    matchId,
    patch: extractPatch(match.info?.gameVersion),
    participants,
  };
}

export function serializeCompactMatchPayload(matchId: string, match: MatchDto) {
  return JSON.stringify(buildCompactMatchPayload(matchId, match));
}

export function compactStoredPayload(
  matchId: string,
  rawPayload: string | null,
): string | null {
  const parsed = parseJson(rawPayload);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const normalized = normalizeStoredPayload(parsed);
  const participants = normalized.info?.participants ?? [];
  if (participants.length === 0) {
    return null;
  }

  return JSON.stringify({
    matchId: normalized.matchId ?? matchId,
    patch: normalized.patch ?? extractPatch(normalized.info?.gameVersion),
    participants: participants.map((participant) => ({
      championId: participant.championId,
      teamId: participant.teamId,
      teamPosition: participant.teamPosition,
      individualPosition: participant.individualPosition,
      opponentChampionId:
        participant.opponentChampionId ?? findStoredOpponentChampionId(participant, participants),
      win: participant.win,
      perks: participant.perks,
      summoner1Id: participant.summoner1Id,
      summoner2Id: participant.summoner2Id,
      item0: participant.item0,
      item1: participant.item1,
      item2: participant.item2,
      item3: participant.item3,
      item4: participant.item4,
      item5: participant.item5,
    })),
  } satisfies CompactMatchPayload);
}

export function parseStoredMatchPayload(
  rawPayload: string | null,
  compactPayload?: string | null,
): NormalizedStoredMatchPayload | null {
  const parsedCompact = parseJson(compactPayload);
  if (parsedCompact) {
    return normalizeStoredPayload(parsedCompact);
  }

  const parsedRaw = parseJson(rawPayload);
  return parsedRaw ? normalizeStoredPayload(parsedRaw) : null;
}

function compactParticipant(
  participant: MatchParticipantDto,
  allParticipants: MatchParticipantDto[],
): StoredParticipant {
  return {
    championId: participant.championId,
    teamId: participant.teamId,
    teamPosition: participant.teamPosition,
    individualPosition: participant.individualPosition,
    opponentChampionId: findOpponentChampionId(participant, allParticipants),
    win: participant.win,
    perks: participant.perks,
    summoner1Id: participant.summoner1Id,
    summoner2Id: participant.summoner2Id,
    item0: participant.item0,
    item1: participant.item1,
    item2: participant.item2,
    item3: participant.item3,
    item4: participant.item4,
    item5: participant.item5,
  };
}

function findOpponentChampionId(
  participant: MatchParticipantDto,
  allParticipants: MatchParticipantDto[],
) {
  const role = normalizePosition(participant.teamPosition ?? participant.individualPosition);
  if (!role || !participant.teamId) {
    return undefined;
  }

  return allParticipants.find(
    (candidate) =>
      candidate.teamId &&
      candidate.teamId !== participant.teamId &&
      normalizePosition(candidate.teamPosition ?? candidate.individualPosition) === role,
  )?.championId;
}

function findStoredOpponentChampionId(
  participant: StoredParticipant,
  allParticipants: StoredParticipant[],
) {
  const role = normalizePosition(participant.teamPosition ?? participant.individualPosition);
  if (!role || !participant.teamId) {
    return undefined;
  }

  return allParticipants.find(
    (candidate) =>
      candidate.teamId &&
      candidate.teamId !== participant.teamId &&
      normalizePosition(candidate.teamPosition ?? candidate.individualPosition) === role,
  )?.championId;
}

function normalizeStoredPayload(payload: unknown): NormalizedStoredMatchPayload {
  const source = payload as {
    metadata?: { matchId?: string };
    matchId?: string;
    patch?: string;
    participants?: StoredParticipant[];
    info?: {
      gameVersion?: string;
      participants?: StoredParticipant[];
    };
  };

  if (Array.isArray(source.participants)) {
    return {
      matchId: source.matchId,
      patch: source.patch,
      info: {
        gameVersion: source.patch,
        participants: source.participants,
      },
    };
  }

  return {
    matchId: source.metadata?.matchId ?? source.matchId,
    patch: source.patch ?? extractPatch(source.info?.gameVersion) ?? undefined,
    info: source.info,
  };
}

function parseJson(value: string | null | undefined): unknown | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function normalizePosition(value: string | undefined) {
  return (value ?? "").toUpperCase();
}

function extractPatch(version: string | undefined): string | null {
  if (!version) {
    return null;
  }

  const parts = version.split(".");
  return parts.length < 2 ? version : `${parts[0]}.${parts[1]}`;
}
