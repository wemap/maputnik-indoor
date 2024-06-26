import { Map } from 'maplibre-gl';

export default class LevelSelector {
  _map: Map | undefined = undefined;
  _container: HTMLDivElement | undefined = undefined;
  _inputEl!: HTMLInputElement;
  _inputTimeout: ReturnType<typeof setTimeout> | undefined = undefined;
  _currentLevel: number = 0;

  onAdd(map: Map) {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = 'maplibregl-ctrl maplibregl-ctrl-level-selector';
    this._container.setAttribute("data-wd-key", "maplibre:ctrl-level-selector");
    this._container.innerHTML = `
        <label for="level-selector">Level selector:</label>
        <input type="number" value="0" id="level-selector" />
    `;
    this._inputEl = this._container.querySelector("input")!;

    return this._container;
  }

  getCurrentLevel() {
    return this._currentLevel;
  }

  updateLevelSelector(level: number) {
    this._inputEl.value = level.toString();
    this._currentLevel = level;
  }

  onLevelChange(callback: (level: number) => void) {
    this._inputEl.addEventListener('change', () => {
      clearTimeout(this._inputTimeout);

      this._currentLevel = Number(this._inputEl.value);

      this._inputTimeout = setTimeout(() => {
        callback(Number(this._inputEl.value));
      }, 500);
    });
  }

  onRemove() {
        this._container!.parentNode!.removeChild(this._container!);
        this._map = undefined;
  }
}
