// Whose voice the Record and Import pages are taking. It is the default person
// unless someone else is picked there; the pick lasts while the app is open
// and is never stored, so a guest's turn cannot linger into the next day's
// own takes.
export const taking = $state<{ id: number | null }>({ id: null });
