import { v4 as uuidv4 } from 'uuid';

export class Duel {
  constructor(p1, p2) {
    this.id = uuidv4();
    this.p1 = p1;
    this.p2 = p2;
    this.state = 'pending'; // -> active -> ended
    this.turn = null;
    this.hp = { [p1]: 100, [p2]: 100 };
    this.blocked = { [p1]: false, [p2]: false };
    this.turnNo = 0;

    // Track strikes for the "3 hits minimum to run" rule
    this.roundStrikes = 0;            // total number of successful strike actions so far
    this.hitsDealt = { [p1]: 0, [p2]: 0 };
  }

  start(first) {
    this.state = 'active';
    this.turn = first;
    this.turnNo = 1;
  }

  opponent(pid) {
    return pid === this.p1 ? this.p2 : this.p1;
  }

  isOver() {
    return this.hp[this.p1] <= 0 || this.hp[this.p2] <= 0;
  }

  winner() {
    if (!this.isOver()) return null;
    return this.hp[this.p1] <= 0 ? this.p2 : this.p1;
  }

  canFlee() {
    // Simple “RuneScape Classic style” rule: after 3 successful strikes have occurred,
    // either participant may flee if they’re still alive.
    return this.roundStrikes >= 3;
  }

  action(actor, act) {
    if (this.state !== 'active') return { error: 'Duel not active' };
    if (this.turn !== actor) return { error: 'Not your turn' };

    const opp = this.opponent(actor);
    let result = { ok: true, act };

    switch (act) {
      case 'strike': {
        let dmg = 18;
        if (this.blocked[opp]) {
          dmg = Math.ceil(dmg / 2);
          this.blocked[opp] = false;
        }
        this.hp[opp] -= dmg;
        this.roundStrikes += 1;
        this.hitsDealt[actor] += 1;
        result.dmg = dmg;
        result.roundStrikes = this.roundStrikes;
        break;
      }
      case 'block':
        this.blocked[actor] = true;
        break;
      case 'heal':
        this.hp[actor] = Math.min(100, this.hp[actor] + 15);
        break;
      case 'flee': {
        if (!this.canFlee()) return { error: 'You cannot run yet (need 3 hits total).' };
        if (this.hp[actor] <= 0) return { error: 'You are dead.' };
        // Flee ends the duel with no winner.
        this.state = 'ended';
        result.fled = actor;
        break;
      }
      default:
        return { error: 'Bad action' };
    }

    if (this.state !== 'ended') {
      if (!this.isOver()) {
        this.turn = opp;
        this.turnNo += 1;
      } else {
        this.state = 'ended';
        result.winner = this.winner();
      }
    } else {
      // Already ended via flee
      result.winner = this.winner() || null;
    }

    return result;
  }
}
