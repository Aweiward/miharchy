package yomi.host

import eu.kanade.tachiyomi.source.model.Filter
import eu.kanade.tachiyomi.source.model.FilterList
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** A source's filters as JSON for the app. The app sends the same shape back and [applyJson] copies the states over by position. */
fun FilterList.toJson(): JsonArray = JsonArray(map { it.filterJson() })

private fun Filter<*>.filterJson(): JsonObject = buildJsonObject {
    put("name", name)
    when (val f = this@filterJson) {
        is Filter.Header -> put("type", "header")
        is Filter.Separator -> put("type", "separator")
        is Filter.Select<*> -> {
            put("type", "select")
            put("values", JsonArray(f.values.map { JsonPrimitive(it.toString()) }))
            put("state", f.state)
        }
        is Filter.Text -> {
            put("type", "text")
            put("state", f.state)
        }
        is Filter.CheckBox -> {
            put("type", "checkbox")
            put("state", f.state)
        }
        is Filter.TriState -> {
            put("type", "tristate")
            put("state", f.state)
        }
        is Filter.Group<*> -> {
            put("type", "group")
            put("filters", JsonArray(f.state.mapNotNull { (it as? Filter<*>)?.filterJson() }))
        }
        is Filter.Sort -> {
            put("type", "sort")
            put("values", JsonArray(f.values.map { JsonPrimitive(it) }))
            put("state", f.state?.let { s -> buildJsonObject { put("index", s.index); put("ascending", s.ascending) } } ?: JsonNull)
        }
    }
}

fun FilterList.applyJson(states: JsonArray) {
    zip(states).forEach { (f, s) -> (s as? JsonObject)?.let { f.applyState(it) } }
}

private fun Filter<*>.applyState(s: JsonObject) {
    val st = s["state"]
    when (val f = this) {
        is Filter.Select<*> -> st?.jsonPrimitive?.intOrNull?.let { f.state = it.coerceIn(0, maxOf(0, f.values.size - 1)) }
        is Filter.Text -> st?.jsonPrimitive?.contentOrNull?.let { f.state = it }
        is Filter.CheckBox -> st?.jsonPrimitive?.booleanOrNull?.let { f.state = it }
        is Filter.TriState -> st?.jsonPrimitive?.intOrNull?.let { f.state = it.coerceIn(0, 2) }
        is Filter.Group<*> -> s["filters"]?.jsonArray?.let { arr ->
            f.state.zip(arr).forEach { (c, cs) -> (c as? Filter<*>)?.applyState(cs.jsonObject) }
        }
        is Filter.Sort -> f.state = (st as? JsonObject)?.let {
            val index = it["index"]?.jsonPrimitive?.intOrNull ?: return
            Filter.Sort.Selection(index.coerceIn(0, maxOf(0, f.values.size - 1)), it["ascending"]?.jsonPrimitive?.booleanOrNull ?: true)
        }
        else -> {}
    }
}
