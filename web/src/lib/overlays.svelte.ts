// The two things that open over any page from the keyboard: the command
// palette (Ctrl+K) and the list of keys (?). Their state is here so that
// the shell's buttons and the components themselves share it.
export const overlays = $state({ palette: false, keys: false });
