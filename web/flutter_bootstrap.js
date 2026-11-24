{{flutter_js}}
{{flutter_build_config}}

// EnRuta es offline-first: CanvasKit se sirve desde la propia app (canvaskit/)
// en lugar del CDN de Google, para que la versión web arranque sin internet.
_flutter.loader.load({
  config: {
    canvasKitBaseUrl: "canvaskit/",
  },
});
