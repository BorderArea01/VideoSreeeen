import { invitationServer, parseInvite, serverOrigin } from '../shared/invite';

export type TabSession = { server: string; invite: string; name: string; resume: string };
const key = 'vs-room-session';

/** App membership only, scoped to one tab; never a site Cookie or a URL parameter. */
export class TabSessions {
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {}
  clear() {
    try {
      this.storage.removeItem(key);
    } catch {}
  }
  save(session: TabSession) {
    try {
      this.storage.setItem(key, JSON.stringify(session));
    } catch {}
  }
  restore(navigation: string, explicitInvite = ''): TabSession | null {
    try {
      // A new/opener-copied tab must not take over another live tab's identity.
      if (!['reload', 'back_forward'].includes(navigation)) {
        this.clear();
        return null;
      }
      const raw = this.storage.getItem(key);
      if (!raw || raw.length > 2048) return null;
      const s = JSON.parse(raw);
      if (!s || !['server', 'invite', 'name', 'resume'].every((k) => typeof s[k] === 'string'))
        throw new Error('Invalid tab session');
      const invite = parseInvite(s.invite);
      if (
        !invite ||
        serverOrigin(s.server) !== s.server ||
        invitationServer(s.invite, s.server) !== s.server ||
        !s.name.trim() ||
        s.name.length > 30 ||
        !/^[A-Za-z0-9_-]{24,100}$/.test(s.resume)
      )
        throw new Error('Invalid tab session');
      if (explicitInvite) {
        const explicit = parseInvite(explicitInvite);
        if (
          !explicit ||
          explicit.code !== invite.code ||
          explicit.token !== invite.token ||
          invitationServer(explicitInvite, s.server) !== s.server
        )
          throw new Error('Different room invitation');
      }
      return { server: s.server, invite: s.invite, name: s.name, resume: s.resume };
    } catch {
      this.clear();
      return null;
    }
  }
}
