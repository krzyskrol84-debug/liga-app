use std::fs;
use std::path::PathBuf;

use rusqlite::{params, Connection};
use tauri::{AppHandle, Manager};

pub struct Database {
    path: PathBuf,
}

impl Database {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn connect(&self) -> rusqlite::Result<Connection> {
        let connection = Connection::open(&self.path)?;
        configure_connection(&connection)?;
        Ok(connection)
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }
}

struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "init_domain_tables",
        sql: include_str!("../../../migrations/001_init.sql"),
    },
    Migration {
        version: 2,
        name: "legacy_cache_tables",
        sql: include_str!("../../../migrations/002_legacy_cache_tables.sql"),
    },
    Migration {
        version: 3,
        name: "local_helper_tables",
        sql: include_str!("../../../migrations/003_local_helper_tables.sql"),
    },
];

pub fn init(app: &AppHandle) -> Result<Database, Box<dyn std::error::Error>> {
    let app_data_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&app_data_dir)?;

    let db_path = app_data_dir.join("liga.sqlite");
    let mut connection = Connection::open(&db_path)?;
    configure_connection(&connection)?;
    run_migrations(&mut connection)?;

    Ok(Database::new(db_path))
}

fn configure_connection(connection: &Connection) -> rusqlite::Result<()> {
    connection.pragma_update(None, "foreign_keys", "ON")?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    Ok(())
}

fn run_migrations(connection: &mut Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        "#,
    )?;

    for migration in MIGRATIONS {
        let already_applied: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = ?1)",
            params![migration.version],
            |row| row.get(0),
        )?;

        if already_applied {
            continue;
        }

        let transaction = connection.transaction()?;
        transaction.execute_batch(migration.sql)?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, name) VALUES (?1, ?2)",
            params![migration.version, migration.name],
        )?;
        transaction.commit()?;
    }

    Ok(())
}
