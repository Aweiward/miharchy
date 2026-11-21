package miharchy.core

import kotlinx.coroutines.ExecutorCoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.withContext
import java.nio.file.Path
import java.sql.Connection
import java.sql.DriverManager
import java.util.concurrent.Executors

/**
 * The SQLite database. One connection, used from one thread, so writes never race.
 * ponytail: one connection serializes every query; add a read pool if a slow read blocks a write.
 */
class Database(file: Path, private val migrations: List<String> = MIGRATIONS) : AutoCloseable {
    private val connection: Connection = DriverManager.getConnection("jdbc:sqlite:$file")
    private val thread: ExecutorCoroutineDispatcher = Executors.newSingleThreadExecutor { Thread(it, "database") }.asCoroutineDispatcher()

    init {
        exec("PRAGMA journal_mode = WAL")
        exec("PRAGMA busy_timeout = 5000")
        exec("PRAGMA foreign_keys = ON")
        migrate()
    }

    /** The number of migrations applied, kept in SQLite's `user_version`. */
    val schema: Int get() = connection.createStatement().use { s -> s.executeQuery("PRAGMA user_version").use { it.getInt(1) } }

    suspend fun <T> run(block: (Connection) -> T): T = withContext(thread) { block(connection) }

    /** One statement per command: sqlite-jdbc fails to reuse a statement whose last command returned rows. */
    private fun exec(sql: String) = connection.createStatement().use { it.execute(sql) }

    /** Applies each migration after `user_version`, each in its own transaction. */
    private fun migrate() {
        for (index in schema until migrations.size) {
            val sql = Database::class.java.getResource("/db/${migrations[index]}")?.readText()
                ?: error("migration ${migrations[index]} is missing")
            connection.autoCommit = false
            try {
                // ponytail: splits on ';', so a migration keeps ';' out of string literals.
                sql.lines().filterNot { it.trimStart().startsWith("--") }.joinToString("\n")
                    .split(";").map { it.trim() }.filter { it.isNotEmpty() }.forEach(::exec)
                exec("PRAGMA user_version = ${index + 1}")
                connection.commit()
            } catch (e: Exception) {
                connection.rollback()
                throw e
            } finally {
                connection.autoCommit = true
            }
        }
    }

    override fun close() {
        thread.close()
        connection.close()
    }

    companion object {
        /** In order. Never edit one that has shipped; add the next. */
        val MIGRATIONS = listOf("0001-metas.sql", "0002-extension-store.sql", "0003-manga-chapter.sql")
    }
}
