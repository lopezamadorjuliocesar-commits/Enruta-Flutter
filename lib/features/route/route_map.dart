import 'dart:convert';

import 'package:material_ui/material_ui.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../core/config/app_config.dart';
import '../../core/theme/app_colors.dart';
import '../../core/utils/dates.dart';
import '../../domain/entities.dart';
import '../../domain/enums.dart';
import '../../domain/location_fix.dart';

/// Mapa Mapbox GL JS en WebView. Requiere token (`MAPBOX_ACCESS_TOKEN`) y red.
/// - Solo se dibujan paradas con coordenadas guardadas (no se inventan posiciones).
/// - La ubicación del conductor se muestra solo si existe, con su antigüedad.
/// - El trazado vial se calcula con Mapbox Directions bajo demanda; si falla,
///   NO se dibuja una línea recta como si fuera una ruta.
class RouteMapView extends StatefulWidget {
  const RouteMapView({super.key, required this.stops, this.driverFix, this.onError});
  final List<Stop> stops;
  final LocationFix? driverFix;
  final ValueChanged<String>? onError;
  @override
  State<RouteMapView> createState() => RouteMapViewState();
}

class RouteMapViewState extends State<RouteMapView> {
  late final WebViewController _c;
  bool _ready = false;
  String? _error;
  String? _routeInfo;

  @override
  void initState() {
    super.initState();
    _c = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(AppColors.soft)
      ..addJavaScriptChannel('Bridge', onMessageReceived: _onMessage)
      ..loadHtmlString(_html(AppConfig.mapboxToken), baseUrl: 'https://enruta.app/');
  }

  void _onMessage(JavaScriptMessage m) {
    final msg = m.message;
    if (!mounted) return;
    if (msg == 'ready') {
      setState(() {
        _ready = true;
        _error = null;
      });
      _push();
    } else if (msg.startsWith('error:')) {
      setState(() => _error = msg.substring(6));
      widget.onError?.call(_error!);
    } else if (msg.startsWith('route:')) {
      setState(() => _routeInfo = msg.substring(6));
    }
  }

  static String _color(StopStatus s) => switch (s) {
        StopStatus.delivered => '#17633F',
        StopStatus.partial => '#E8B000',
        StopStatus.failed => '#A32C1E',
        StopStatus.skipped => '#51677B',
        StopStatus.pending => '#14497A',
      };

  void _push() {
    if (!_ready) return;
    final next = widget.stops.where((s) => s.status == StopStatus.pending).firstOrNull;
    final data = [
      for (final s in widget.stops.where((s) => s.address.hasCoords))
        {
          'n': s.seq,
          'name': s.customer.name,
          'address': s.address.full,
          'status': s.status.label,
          'lat': s.address.lat,
          'lng': s.address.lng,
          'color': _color(s.status),
          'active': s.id == next?.id,
          'pending': s.status == StopStatus.pending,
        }
    ];
    final f = widget.driverFix;
    final driver = f != null && f.hasPosition
        ? {'lat': f.latitude, 'lng': f.longitude, 'label': f.describe(), 'age': f.age == null ? '' : ago(f.age!)}
        : null;
    _c.runJavaScript('window.setData(${jsonEncode(data)}, ${jsonEncode(driver)});');
  }

  /// Solicita el trazado vial a Mapbox Directions (bajo demanda).
  void requestRoute() => _c.runJavaScript('window.drawRoute();');

  @override
  void didUpdateWidget(covariant RouteMapView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.stops != widget.stops || oldWidget.driverFix != widget.driverFix) _push();
  }

  @override
  Widget build(BuildContext context) => ClipRect(
        child: Stack(children: [
          Positioned.fill(child: WebViewWidget(controller: _c)),
          if (!_ready && _error == null) const Center(child: CircularProgressIndicator()),
          if (_error != null || _routeInfo != null)
            Positioned(
              left: 12,
              right: 12,
              top: 12,
              child: Material(
                color: _error != null ? AppColors.warningBg : AppColors.card,
                borderRadius: BorderRadius.circular(10),
                elevation: 2,
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Text(_error ?? _routeInfo!, style: TextStyle(color: _error != null ? AppColors.warning : AppColors.text, fontSize: 12.5)),
                ),
              ),
            ),
        ]),
      );
}

String _html(String token) => '''
<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link href="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.css" rel="stylesheet">
<script src="https://api.mapbox.com/mapbox-gl-js/v3.7.0/mapbox-gl.js"></script>
<style>
html,body,#map{margin:0;height:100%;width:100%;background:#E1ECF5;font-family:sans-serif}
.pin{width:30px;height:30px;border-radius:50%;border:3px solid #fff;color:#fff;font-weight:800;font-size:13px;
display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.4)}
.pin.active{width:38px;height:38px;box-shadow:0 0 0 6px rgba(232,176,0,.45)}
.me{width:18px;height:18px;border-radius:50%;background:#1a73e8;border:3px solid #fff;box-shadow:0 0 0 6px rgba(26,115,232,.25)}
</style></head><body><div id="map"></div><script>
const TOKEN=${jsonEncode(token)};
const post=m=>{try{Bridge.postMessage(m)}catch(e){}};
let map,markers=[],pending=null,loaded=false,stops=[];
if(typeof mapboxgl==='undefined'){post('error:No se pudo descargar la cartografía. Continúa desde la lista de paradas.');}
else{
 mapboxgl.accessToken=TOKEN;
 map=new mapboxgl.Map({container:'map',style:'mapbox://styles/mapbox/streets-v12',center:[-96.92,19.54],zoom:11});
 map.addControl(new mapboxgl.NavigationControl({showCompass:false}),'top-right');
 map.on('error',e=>{const s=e&&e.error&&e.error.status; if(s===401||s===403)post('error:El token de Mapbox no es válido o no tiene permisos.'); else if(!loaded)post('error:No se pudo cargar el mapa. Revisa tu conexión.');});
 map.on('load',()=>{loaded=true;
  map.addSource('route',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
  map.addLayer({id:'route',type:'line',source:'route',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':'#14497A','line-width':5,'line-opacity':.8}});
  post('ready'); if(pending){window.setData(pending[0],pending[1]);}
 });
}
function popup(title,body){const d=document.createElement('div');const b=document.createElement('strong');b.textContent=title;const p=document.createElement('div');p.textContent=body;d.append(b,p);return new mapboxgl.Popup({offset:18,closeButton:false}).setDOMContent(d);}
window.setData=function(list,driver){
 if(!map||!loaded){pending=[list,driver];return;}
 stops=list; markers.forEach(m=>m.remove()); markers=[];
 const bounds=new mapboxgl.LngLatBounds(); let any=false;
 for(const s of list){const c=[s.lng,s.lat];bounds.extend(c);any=true;
  const el=document.createElement('div');el.className='pin'+(s.active?' active':'');el.style.background=s.color;el.textContent=s.n;
  markers.push(new mapboxgl.Marker({element:el}).setLngLat(c).setPopup(popup(s.n+'. '+s.name,s.address+' · '+s.status)).addTo(map));}
 if(driver){const c=[driver.lng,driver.lat];bounds.extend(c);any=true;const el=document.createElement('div');el.className='me';
  markers.push(new mapboxgl.Marker({element:el}).setLngLat(c).setPopup(popup('Tu ubicación',driver.label)).addTo(map));}
 if(any)map.fitBounds(bounds,{padding:60,maxZoom:15,duration:500});
};
window.drawRoute=async function(){
 const pts=stops.filter(s=>s.pending).map(s=>[s.lng,s.lat]);
 if(pts.length<2){post('route:Se necesitan al menos 2 paradas pendientes con coordenadas.');return;}
 try{const geom=[];let dist=0;
  for(let i=0;i<pts.length-1;i+=24){const ch=pts.slice(i,i+25);if(ch.length<2)break;
   const r=await fetch('https://api.mapbox.com/directions/v5/mapbox/driving/'+ch.map(p=>p[0]+','+p[1]).join(';')+'?geometries=geojson&overview=full&access_token='+TOKEN);
   if(!r.ok)throw 0;const d=await r.json();if(!d.routes||!d.routes[0])throw 0;geom.push(...d.routes[0].geometry.coordinates);dist+=d.routes[0].distance;}
  map.getSource('route').setData({type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:geom}}]});
  post('route:Trazado vial sugerido por Mapbox Directions en el orden de visita · '+(dist/1000).toFixed(1)+' km.');
 }catch(e){map.getSource('route').setData({type:'FeatureCollection',features:[]});post('error:No se pudo calcular el trazado vial. Usa la navegación externa.');}
};
</script></body></html>
''';
