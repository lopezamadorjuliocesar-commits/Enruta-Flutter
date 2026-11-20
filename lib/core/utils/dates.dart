const _months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const _days = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

String two(int v) => v.toString().padLeft(2, '0');

/// Fecha de servicio ISO (YYYY-MM-DD) en hora local.
String isoDate(DateTime d) => '${d.year}-${two(d.month)}-${two(d.day)}';
DateTime parseIsoDate(String s) {
  final p = s.split('-').map(int.parse).toList();
  return DateTime(p[0], p[1], p[2]);
}

String shortDate(DateTime d) => '${two(d.day)} ${_months[d.month - 1]}';
String fullDate(DateTime d) => '${shortDate(d)} ${d.year}';
String weekdayDate(DateTime d) => '${_days[d.weekday - 1]} ${fullDate(d)}';
String hm(DateTime d) => '${two(d.hour)}:${two(d.minute)}';
String dateTime(DateTime d) => '${fullDate(d)} · ${hm(d)}';

/// “hace 3 min”, “hace 2 h”… para mostrar la antigüedad real de un dato.
String ago(Duration d) {
  if (d.isNegative || d.inSeconds < 60) return 'hace ${d.isNegative ? 0 : d.inSeconds} s';
  if (d.inMinutes < 60) return 'hace ${d.inMinutes} min';
  if (d.inHours < 48) return 'hace ${d.inHours} h';
  return 'hace ${d.inDays} días';
}

DateTime fromMs(int ms) => DateTime.fromMillisecondsSinceEpoch(ms);
int? msOrNull(DateTime? d) => d?.millisecondsSinceEpoch;
DateTime? fromMsOrNull(Object? v) => v == null ? null : DateTime.fromMillisecondsSinceEpoch(v as int);
