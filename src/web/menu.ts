// The hamburger: hides everything under the title (lines, clock, buttons), so that the map is clear on a small screen.
// Open at start on a wide screen, closed on a phone.

export function setupMenu(): void {
  const toggle = document.querySelector<HTMLButtonElement>('#menu-toggle')!;
  const menu = document.querySelector<HTMLElement>('#menu')!;
  const open = (on: boolean) => {
    menu.hidden = !on;
    toggle.setAttribute('aria-expanded', String(on));
  };
  toggle.addEventListener('click', () => open(menu.hidden === true));
  open(!window.matchMedia('(max-width: 560px)').matches);
}
