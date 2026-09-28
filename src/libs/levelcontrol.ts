import {type Map} from "maplibre-gl";

const LEVELS_VISIBLE = 4;

export default class LevelControl {
  _map: Map | undefined = undefined;
  _container: HTMLDivElement | undefined = undefined;
  _activeLevel: number | null = 0;  // 0 par défaut à l'ouverture

  onLevelChange: ((level: number | null) => void) | null = null;

  constructor() {}

  onAdd(map: Map) {
    this._map = map;
    this._container = document.createElement("div");
    this._container.className = "maplibregl-ctrl maplibregl-ctrl-group maputnik-level-ctrl";
    this._render();
    return this._container;
  }

  onRemove() {
    this._container!.parentNode?.removeChild(this._container!);
    this._map = undefined;
  }

  _render() {
    const c = this._container!;
    c.innerHTML = "";
    const center = this._activeLevel ?? 0;

    const btnUp = document.createElement("button");
    btnUp.className = "maputnik-level-ctrl__arrow";
    btnUp.title = "Higher level";
    btnUp.innerHTML = `<svg viewBox="0 0 10 6" width="10" height="6"><polyline points="1,5 5,1 9,5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    btnUp.addEventListener("click", () => {
      this._activeLevel = center + 1;
      this._render();
      this.onLevelChange?.(this._activeLevel);
    });
    c.appendChild(btnUp);

    for (let i = LEVELS_VISIBLE; i >= -LEVELS_VISIBLE; i--) {
      const level = center + i;
      const btn = document.createElement("button");
      btn.className = "maputnik-level-ctrl__level";
      // Actif si ce level est sélectionné ; re-cliquer désactive
      if (level === this._activeLevel) btn.classList.add("maputnik-level-ctrl__level--active");
      btn.textContent = String(level);
      btn.title = `Level ${level}`;
      btn.addEventListener("click", () => {
        this._activeLevel = (level === this._activeLevel) ? null : level;
        this._render();
        this.onLevelChange?.(this._activeLevel);
      });
      c.appendChild(btn);
    }

    const btnDown = document.createElement("button");
    btnDown.className = "maputnik-level-ctrl__arrow";
    btnDown.title = "Lower level";
    btnDown.innerHTML = `<svg viewBox="0 0 10 6" width="10" height="6"><polyline points="1,1 5,5 9,1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    btnDown.addEventListener("click", () => {
      this._activeLevel = center - 1;
      this._render();
      this.onLevelChange?.(this._activeLevel);
    });
    c.appendChild(btnDown);
  }
}
