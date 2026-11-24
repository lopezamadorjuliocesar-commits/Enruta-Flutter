import 'package:sqflite/sqflite.dart';
import 'package:sqflite_common_ffi_web/sqflite_ffi_web.dart';

/// Web: SQLite compilado a WebAssembly (web/sqlite3.wasm) ejecutado en un
/// shared worker (web/sqflite_sw.js) y persistido en IndexedDB del navegador.
DatabaseFactory platformDatabaseFactory() => databaseFactoryFfiWeb;

const platformStorageLabel = 'SQLite WebAssembly (IndexedDB del navegador)';
