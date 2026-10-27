// Moderators approve and resolve markets and see the moderation queue (vault "Auth and roles").
export const isModerator = (role: string) => role === 'moderator' || role === 'admin';
