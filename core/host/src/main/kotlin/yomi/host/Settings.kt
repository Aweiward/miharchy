package yomi.host

import android.app.Application
import android.content.Context
import androidx.preference.EditTextPreference
import androidx.preference.ListPreference
import androidx.preference.MultiSelectListPreference
import androidx.preference.Preference
import androidx.preference.PreferenceScreen
import androidx.preference.TwoStatePreference
import eu.kanade.tachiyomi.source.ConfigurableSource
import eu.kanade.tachiyomi.source.Source
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** Where Mihon keeps a source's settings, so extensions read the same file whichever way it was written. */
private fun prefs(source: Source) = Application().getSharedPreferences("source_${source.id}", Context.MODE_PRIVATE)

/** Builds the extension's settings screen fresh, so it reflects what's saved now. */
private fun screen(source: Source): List<Preference> {
    val screen = PreferenceScreen(Application())
    (source as? ConfigurableSource)?.setupPreferenceScreen(screen) ?: return emptyList()
    return screen.hostPreferences().filter { it.key != null && it.hostVisible() }
}

private fun strings(a: Array<CharSequence>) = JsonArray(a.map { JsonPrimitive(it.toString()) })

/** The source's settings and their current values, for the app to draw. */
fun settingsOf(source: Source): JsonElement {
    val p = prefs(source)
    return JsonArray(screen(source).map { pref ->
        val key = pref.key
        val default = pref.hostDefaultValue()
        buildJsonObject {
            put("key", key)
            put("title", pref.title?.toString() ?: key)
            put("summary", pref.summary?.toString() ?: "")
            put("enabled", pref.hostEnabled())
            when (pref) {
                is TwoStatePreference -> {
                    put("type", "switch")
                    put("value", p.getBoolean(key, default as? Boolean ?: pref.isChecked))
                    pref.summaryOn?.let { put("summaryOn", it.toString()) }
                    pref.summaryOff?.let { put("summaryOff", it.toString()) }
                }
                is ListPreference -> {
                    put("type", "list")
                    put("entries", strings(pref.entries))
                    put("values", strings(pref.entryValues))
                    put("value", p.getString(key, default as? String ?: pref.value) ?: "")
                }
                is MultiSelectListPreference -> {
                    put("type", "multi")
                    put("entries", strings(pref.entries))
                    put("values", strings(pref.entryValues))
                    @Suppress("UNCHECKED_CAST")
                    val chosen = p.getStringSet(key, default as? Set<String> ?: pref.values) ?: emptySet()
                    put("value", JsonArray(chosen.map { JsonPrimitive(it) }))
                }
                is EditTextPreference -> {
                    put("type", "text")
                    put("value", p.getString(key, default as? String ?: pref.text) ?: "")
                    pref.dialogMessage?.let { put("message", it.toString()) }
                }
                else -> put("type", "info")
            }
        }
    })
}

/** Saves one setting the way the extension's own screen would, after asking its change listener. */
fun setSetting(source: Source, key: String, value: JsonElement): JsonElement {
    val pref = screen(source).firstOrNull { it.key == key } ?: throw IllegalArgumentException("no setting $key")
    val newValue: Any = when (pref) {
        is TwoStatePreference -> value.jsonPrimitive.booleanOrNull ?: throw IllegalArgumentException("expected true or false")
        is MultiSelectListPreference -> value.jsonArray.map { it.jsonPrimitive.content }.toSet()
        else -> if (value is JsonNull) "" else value.jsonPrimitive.content
    }
    // An extension can refuse a value, as on Android.
    if (pref.hostChangeListener()?.onPreferenceChange(pref, newValue) == false) return JsonPrimitive(false)
    val edit = prefs(source).edit()
    @Suppress("UNCHECKED_CAST")
    when (newValue) {
        is Boolean -> edit.putBoolean(key, newValue)
        is Set<*> -> edit.putStringSet(key, newValue as Set<String>)
        else -> edit.putString(key, newValue.toString())
    }
    edit.apply()
    return JsonPrimitive(true)
}
