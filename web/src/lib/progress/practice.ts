// Practice as data: what a session amounted to, and practice day by day.
import type { PracticeOut, TakeOut } from '#lib/api/types.js';
import { dayOf } from '#lib/stats.js';

const MINUTE = 60_000;
const DAY = 86_400_000;
/** A session's practice starts this long before its first take: the reading and the trying. */
const LEAD_MIN = 1;
/** A session is over this long after its last take, whenever it was closed. */
const TAIL_MIN = 2;

/** What one session amounted to. */
export type SessionFact = {
	id: string;
	/** When it started, in ms. */
	at: number;
	/** How long it was practised for, in minutes: see `minutesOf`. */
	minutes: number;
	takes: number;
	/** The takes an exercise judged, and how many of those met their bar. */
	judged: number;
	met: number;
	comfort: number | null;
	tension: boolean | null;
	routine: string | null;
};

/**
 * Minutes of practice in a session: from a little before its first take to a little
 * after its last one, inside the time it was open. A session opened an hour before
 * anything was recorded, or closed an hour after, was not practised for that hour.
 *
 * @param firstTake When its first take was recorded (ISO); the session's start without it.
 */
export function minutesOf(session: PracticeOut, firstTake?: string | null): number {
	if (!session.last_take_at) return 0;
	const opened = Date.parse(session.started_at);
	const began = firstTake ? Math.max(opened, Date.parse(firstTake) - LEAD_MIN * MINUTE) : opened;
	const worked = Date.parse(session.last_take_at) + TAIL_MIN * MINUTE;
	const closed = session.ended_at ? Date.parse(session.ended_at) : Infinity;
	return Math.max(0, Math.round(((Math.min(worked, closed) - began) / MINUTE) * 10) / 10);
}

/** Sessions with what their takes say, oldest first. */
export function sessionFacts(
	sessions: readonly PracticeOut[],
	takes: readonly TakeOut[]
): SessionFact[] {
	return sessions
		.map((session) => {
			const own = takes.filter((take) => take.session_id === session.id);
			const judged = own.filter((take) => typeof take.evaluation?.met === 'boolean');
			const first = own.map((take) => take.recorded_at).sort()[0] ?? null;
			return {
				id: session.id,
				at: Date.parse(session.started_at),
				minutes: minutesOf(session, first),
				takes: session.take_count,
				judged: judged.length,
				met: judged.filter((take) => take.evaluation?.met === true).length,
				comfort: session.comfort_end,
				tension: session.lasting_tension,
				routine: session.routine_ref?.split('@')[0] ?? null
			};
		})
		.sort((a, b) => a.at - b.at);
}

/**
 * Minutes per day and per routine, on every day from the first session's to the last
 * one's (days without practice are there, with nothing): for bars without gaps.
 */
export function dailyMinutes(facts: readonly SessionFact[]): {
	days: number[];
	routines: { routine: string | null; values: number[] }[];
} {
	const worked = facts.filter((fact) => fact.minutes > 0);
	if (!worked.length) return { days: [], routines: [] };
	const first = dayOf(worked[0].at);
	const last = dayOf(worked[worked.length - 1].at);
	const days: number[] = [];
	// NOTE: day by day through the calendar, not by 24 hours: a clock change must not skip one
	for (let day = first; day <= last; day = dayOf(day + DAY + DAY / 4)) days.push(day);
	const routines: { routine: string | null; values: number[] }[] = [];
	for (const fact of worked) {
		let row = routines.find((r) => r.routine === fact.routine);
		if (!row) routines.push((row = { routine: fact.routine, values: days.map(() => 0) }));
		const at = days.indexOf(dayOf(fact.at));
		row.values[at] = Math.round((row.values[at] + fact.minutes) * 10) / 10;
	}
	return { days, routines };
}
