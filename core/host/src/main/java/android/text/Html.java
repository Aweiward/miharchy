package android.text;

import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Entities;

/** fromHtml gives the text with line breaks where blocks and <br> were (wholeText turns <br> into one). Styling is dropped. */
public class Html {
    public static final int FROM_HTML_MODE_LEGACY = 0, FROM_HTML_MODE_COMPACT = 63;

    public static Spanned fromHtml(String source, int flags) {
        Document doc = Jsoup.parse(source == null ? "" : source);
        doc.outputSettings().prettyPrint(false);
        doc.select("p, div, li, h1, h2, h3, h4, h5, h6, blockquote, tr").after("\n");
        return new SpannableString(doc.body().wholeText().replaceAll("\n{3,}", "\n\n").strip());
    }

    public static Spanned fromHtml(String source) { return fromHtml(source, FROM_HTML_MODE_LEGACY); }
    public static String escapeHtml(CharSequence text) { return Entities.escape(text.toString()); }
    public static String toHtml(Spanned text, int option) { return escapeHtml(text); }
}
