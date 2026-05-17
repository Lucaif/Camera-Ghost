export type Tilt = { x: number; y: number; z: number };

export type Project = {
  id: string;
  name: string;
  ghostUri: string | null;
  ghostTilt: Tilt | null;
  photos: string[];
  createdAt: number;
};
