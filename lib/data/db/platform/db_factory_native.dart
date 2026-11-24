import 'package:sqflite/sqflite.dart';

/// Android/iOS: plugin nativo de sqflite.
DatabaseFactory platformDatabaseFactory() => databaseFactory;

const platformStorageLabel = 'SQLite (archivo en el dispositivo)';
