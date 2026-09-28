import {type Map} from "maplibre-gl";

export default class FitBoundsControl {
  _map: Map | undefined = undefined;
  _container: HTMLDivElement | undefined = undefined;

  onFitBounds: (() => void) | null = null;

  constructor() {}

  onAdd(map: Map) {
    this._map = map;
    this._container = document.createElement("div");
    this._container.className = "maplibregl-ctrl maplibregl-ctrl-group maputnik-fit-ctrl";

    const btn = document.createElement("button");
    btn.className = "maputnik-fit-ctrl__btn";
    btn.title = "Zoom to style bounds";
    btn.innerHTML = `<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="3,7 3,3 7,3"/>
      <polyline points="17,7 17,3 13,3"/>
      <polyline points="3,13 3,17 7,17"/>
      <polyline points="17,13 17,17 13,17"/>
      <rect x="6" y="6" width="8" height="8" rx="1" stroke-opacity="0.4"/>
    </svg>`;
    btn.addEventListener("click", () => {
      this.onFitBounds?.();
    });

    this._container.appendChild(btn);
    return this._container;
  }

  onRemove() {
    this._container!.parentNode?.removeChild(this._container!);
    this._map = undefined;
  }
}
