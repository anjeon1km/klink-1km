/* global L */
// A Leaflet layer that paints everything through one <canvas> per redraw (thousands of links stay fast).
// draw(ctx, view) is called with view = { project(lat, lon) → [x, y], zoom, width, height, bounds }.
// Between redraws the last drawing is scaled and shifted to follow the map — during zoom animation,
// pinch-zoom and flyTo — the same way Leaflet's own vector renderer does, so roads never lag behind markers.
export const VectorCanvas = L.Layer.extend({
  options: { padding: 0.5 }, // canvas covers the view plus half a view on each side: zooming out one level stays filled
  initialize(draw, options = {}) { this._draw = draw; L.setOptions(this, options); },
  onAdd(map) {
    this._map = map;
    const pane = map.getPane(this.options.pane || 'overlayPane');
    this._canvas = L.DomUtil.create('canvas', 'leaflet-zoom-animated', pane);
    this._canvas.style.pointerEvents = 'none';
    map.on('moveend', this.redraw, this);
    map.on('zoom', this._onZoom, this);
    map.on('zoomanim', this._animateZoom, this);
    map.on('resize', this.redraw, this);
    this.redraw();
  },
  onRemove(map) {
    L.DomUtil.remove(this._canvas);
    map.off('moveend', this.redraw, this); map.off('zoom', this._onZoom, this); map.off('zoomanim', this._animateZoom, this); map.off('resize', this.redraw, this);
  },
  _onZoom() { this._updateTransform(this._map.getCenter(), this._map.getZoom()); },
  _animateZoom(e) { this._updateTransform(e.center, e.zoom); },
  _updateTransform(center, zoom) {
    if (!this._center) return;
    const map = this._map, scale = map.getZoomScale(zoom, this._zoom);
    const viewHalf = map.getSize().multiplyBy(0.5 + this.options.padding);
    const topLeft = viewHalf.multiplyBy(-scale).add(map.project(this._center, zoom)).subtract(map._getNewPixelOrigin(center, zoom));
    L.DomUtil.setTransform(this._canvas, topLeft, scale);
  },
  redraw() {
    if (!this._map) return;
    const map = this._map, size = map.getSize(), pad = this.options.padding;
    const w = Math.round(size.x * (1 + 2 * pad)), hgt = Math.round(size.y * (1 + 2 * pad));
    const topLeft = map.containerPointToLayerPoint([-size.x * pad, -size.y * pad]).round();
    this._center = map.getCenter(); this._zoom = map.getZoom();
    L.DomUtil.setTransform(this._canvas, topLeft, 1);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const c = this._canvas;
    c.width = w * dpr; c.height = hgt * dpr; c.style.width = w + 'px'; c.style.height = hgt + 'px';
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const zoom = this._zoom, origin = map.getPixelOrigin();
    const ox = topLeft.x + origin.x, oy = topLeft.y + origin.y;
    const project = (lat, lon) => { const p = map.project([lat, lon], zoom); return [p.x - ox, p.y - oy]; };
    const sw = map.containerPointToLatLng([-size.x * pad, size.y * (1 + pad)]), ne = map.containerPointToLatLng([size.x * (1 + pad), -size.y * pad]);
    this._draw(ctx, { project, zoom, width: w, height: hgt, bounds: { s: sw.lat, w: sw.lng, n: ne.lat, e: ne.lng } });
  },
});
