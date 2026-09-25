export type Day = 'fri' | 'sat' | 'sun';
export type Stage = 'main' | 'isle' | 'lounge';

export interface Summary {
  signedCount: number;
  ticketsLeft: number;
  capacity: number;
  brandPartners: number;
  serverNow: number;
}

export interface Session {
  id: string;
  day: Day;
  stage: Stage;
  start: string;
  end: string;
  title: string;
  artist: string;
  tag: string;
}

export interface Artist {
  id: string;
  name: string;
  enName: string;
  genre: string;
  city: string;
  votes: number;
  headliner: boolean;
}

export type NoticeKind = 'shuttle' | 'entry' | 'weather' | 'camp';

export interface Notice {
  id: string;
  kind: NoticeKind;
  title: string;
  body: string;
}

export interface ScheduleData {
  days: Day[];
  sessions: Session[];
}

export interface RegisterBody {
  name: string;
  phone: string;
  qty: number;
  tier: string;
}

export interface RegisterOk {
  ok: true;
  registrationId: string;
  signedCount: number;
  ticketsLeft: number;
}

export interface VoteOk {
  ok: true;
  artistId: string;
  votes: number;
}

export interface ApiError extends Error {
  status: number;
  code: string;
}

export interface HomePayload {
  summary: Summary;
  lineup: Artist[];
  noticesCount: number;
}
