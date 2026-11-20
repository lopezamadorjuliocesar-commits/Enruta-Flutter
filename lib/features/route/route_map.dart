import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../core/config.dart';
import '../../core/domain/models.dart';
import '../../core/theme/app_colors.dart';

/// Mapa interactivo Mapbox GL JS (WebView).
/// - Marcadores numerados: verde = completada, rojo = no entregada, amarillo = pendiente/siguiente.
/// - Ruta real por la Directions API de Mapbox (polilínea punteada); si falla, línea recta.
/// - Paradas sin coordenadas se geocodifican por dirección (Geocoding API v6).
/// - Control de geolocalización, zoom y popups. Sin paradas el mapa arranca vacío.
class RouteMapView extends StatefulWidget {
  const RouteMapView({super.key, required this.stops, this.interactive = true});
  final List<Stop> stops;
  final bool interactive;
  @override
  State<RouteMapView> createState() => _RouteMapViewState();
}

class _RouteMapViewState extends State<RouteMapView> {
  late final WebViewController _c;
  bool _ready = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _c = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(AppColors.soft)
      ..addJavaScriptChannel('Bridge', onMessageReceived: _onMessage)
      ..loadHtmlString(_html(widget.interactive), baseUrl: 'https://enruta.app/');
  }

  void _onMessage(JavaScriptMessage m) {
    final msg = m.message;
    if (msg == 'ready') {
      _ready = true;
      if (mounted) setState(() => _error = null);
      _push();
    } else if (msg.startsWith('error:') && mounted) {
      setState(() => _error = msg.substring(6));
    }
  }

  static String _color(StopStatus s) => switch (s) {
        StopStatus.delivered || StopStatus.partial => '#1B6E51',
        StopStatus.failed => '#A32C1E',
        _ => '#E8B000',
      };

  void _push() {
    if (!_ready) return;
    final data = [
      for (final s in widget.stops)
        {
          'n': s.number,
          'name': s.name,
          'address': s.address,
          'lat': s.lat,
          'lng': s.lng,
          'color': _color(s.status),
          'active': s.status == StopStatus.next,
          'eta': s.eta,
        }
    ];
    _c.runJavaScript('window.setStops(${jsonEncode(data)});');
  }

  @override
  void didUpdateWidget(covariant RouteMapView old) {
    super.didUpdateWidget(old);
    if (old.stops != widget.stops) _push();
  }

  @override
  Widget build(BuildContext context) => ClipRect(
        child: Stack(children: [
          Positioned.fill(child: WebViewWidget(controller: _c)),
          if (_error != null)
            Positioned(
              left: 12,
              right: 12,
              top: 12,
              child: Material(
                color: AppColors.warningBg,
                borderRadius: BorderRadius.circular(10),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Text(_error!, style: const TextStyle(color: AppColors.warning, fontSize: 12)),
                ),
              ),
            ),
        ]),
      );
}

String _html(bool interactive) => '''
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link href="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js"></script>
<style>
html,body,#map{margin:0;height:100%;width:100%;background:#E1ECF5;font-family:sans-serif}
.pin{width:28px;height:28px;border-radius:50%;border:3px solid #fff;color:#0B2F52;font-weight:800;
font-size:12px;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.4)}
.pin.active{width:34px;height:34px;box-shadow:0 0 0 5px rgba(232,176,0,.35)}
</style></head><body><div id="map"></div><script>
const TOKEN='$mapboxToken', INTERACTIVE=$interactive;
const post=m=>{try{Bridge.postMessage(m)}catch(e){}};
let map, markers=[], pending=null, loaded=false, seq=0;
if(typeof mapboxgl==='undefined'){post('error:Sin conexión: el mapa requiere internet la primera vez.');}
else{
mapboxgl.accessToken=TOKEN;
map=new mapboxgl.Map({container:'map',style:'mapbox://styles/mapbox/streets-v12',center:[-99.1332,19.4326],zoom:4,interactive:INTERACTIVE,attributionControl:true});
if(INTERACTIVE){
 map.addControl(new mapboxgl.NavigationControl({showCompass:false}),'top-right');
 map.addControl(new mapboxgl.GeolocateControl({positionOptions:{enableHighAccuracy:true},trackUserLocation:true,showUserLocation:true}),'top-right');
}
map.on('error',e=>{if(!loaded)post('error:No se pudo cargar el mapa. Revisa tu conexión.')});
map.on('load',()=>{
 loaded=true;
 map.addSource('route',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
 map.addLayer({id:'route-casing',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#fff','line-width':8,'line-opacity':.85}});
 map.addLayer({id:'route',type:'line',source:'route',layout:{'line-cap':'butt','line-join':'round'},paint:{'line-color':'#14497A','line-width':4,'line-dasharray':[2,1.5]}});
 post('ready');
 if(pending){window.setStops(pending);}
});
}
async function geocode(q){
 try{const r=await fetch('https://api.mapbox.com/search/geocode/v6/forward?q='+encodeURIComponent(q)+'&limit=1&country=mx&language=es&access_token='+TOKEN);
 if(!r.ok)return null;const d=await r.json();const f=d.features&&d.features[0];
 if(!f)return null;return f.geometry.coordinates;}catch(e){return null}
}
async function directions(pts){
 const geom=[];
 try{
  for(let i=0;i<pts.length-1;i+=24){
   const ch=pts.slice(i,i+25);if(ch.length<2)break;
   const c=ch.map(p=>p[0]+','+p[1]).join(';');
   const r=await fetch('https://api.mapbox.com/directions/v5/mapbox/driving/'+c+'?geometries=geojson&overview=full&access_token='+TOKEN);
   if(!r.ok)throw 0;const d=await r.json();if(!d.routes||!d.routes[0])throw 0;
   geom.push(...d.routes[0].geometry.coordinates);
  }
  return geom;
 }catch(e){return pts}
}
window.setStops=async function(stops){
 if(!map||!loaded){pending=stops;return;}
 const my=++seq;
 markers.forEach(m=>m.remove());markers=[];
 const src=map.getSource('route');
 if(!stops.length){src.setData({type:'FeatureCollection',features:[]});return;}
 const pts=[],bounds=new mapboxgl.LngLatBounds();
 for(const s of stops){
  let c=(s.lat!=null&&s.lng!=null)?[s.lng,s.lat]:await geocode(s.address);
  if(my!==seq)return;
  if(!c)continue;
  pts.push(c);bounds.extend(c);
  const el=document.createElement('div');el.className='pin'+(s.active?' active':'');
  el.style.background=s.color;el.style.color=s.color==='#E8B000'?'#0B2F52':'#fff';el.textContent=s.n;
  const pop=new mapboxgl.Popup({offset:18,closeButton:false}).setDOMContent((()=>{
   const d=document.createElement('div');const b=document.createElement('strong');b.textContent=s.n+'. '+s.name;
   const p=document.createElement('div');p.textContent=s.address+(s.eta?' · ETA '+s.eta:'');d.append(b,p);return d})());
  markers.push(new mapboxgl.Marker({element:el}).setLngLat(c).setPopup(pop).addTo(map));
 }
 if(!pts.length)return;
 map.fitBounds(bounds,{padding:60,maxZoom:15,duration:600});
 if(pts.length>1){
  const g=await directions(pts);if(my!==seq)return;
  src.setData({type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:g}}]});
 }else src.setData({type:'FeatureCollection',features:[]});
};
</script></body></html>
''';
