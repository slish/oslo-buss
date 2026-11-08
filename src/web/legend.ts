// The list of lines in the corner: click a line to hide or show it. The list can be folded away, and on a phone it starts folded.

import { colorOf } from './world';

export class Legend {
  readonly hidden = new Set<string>();
  private readonly items = new Map<string, HTMLLIElement>();
  private readonly body = document.querySelector<HTMLElement>('#legend-body')!;
  private readonly toggle = document.querySelector<HTMLButtonElement>('#legend-toggle')!;

  /** `onChange` is called whenever the set of hidden lines changes. */
  constructor(lines: { name: string; long: string }[], private readonly onChange: () => void) {
    this.toggle.addEventListener('click', () => this.fold(!this.body.hidden));
    this.fold(window.matchMedia('(max-width: 560px)').matches);
    document.querySelector('#legend-count')!.textContent = '(' + lines.length + ')';
    document.querySelector('#lines-all')!.addEventListener('click', () => { this.hidden.clear(); this.changed(); });
    document.querySelector('#lines-none')!.addEventListener('click', () => { for (const l of lines) this.hidden.add(l.name); this.changed(); });
    const list = document.querySelector<HTMLUListElement>('#legend')!;
    for (const line of [...lines].sort((a, b) => parseInt(a.name) - parseInt(b.name) || a.name.localeCompare(b.name))) {
      const li = document.createElement('li');
      li.title = 'Klikk for å skjule eller vise linja';
      li.addEventListener('click', () => { if (this.hidden.has(line.name)) this.hidden.delete(line.name); else this.hidden.add(line.name); this.changed(); });
      li.style.color = colorOf(line.name);
      li.innerHTML = `<span class="dot"></span><span class="name"></span><span class="long"></span>`;
      li.querySelector('.name')!.textContent = line.name;
      li.querySelector('.long')!.textContent = line.long;
      this.items.set(line.name, li);
      list.append(li);
    }
  }

  isHidden(line: string): boolean { return this.hidden.has(line); }

  private fold(fold: boolean): void {
    this.body.hidden = fold;
    this.toggle.setAttribute('aria-expanded', String(!fold));
    this.toggle.querySelector('.arrow')!.textContent = fold ? '▸' : '▾';
  }

  private changed(): void {
    for (const [name, li] of this.items) li.classList.toggle('off', this.hidden.has(name));
    this.onChange();
  }
}
