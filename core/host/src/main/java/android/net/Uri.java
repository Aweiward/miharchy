package android.net;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/** The parts of Android's Uri that extensions read. Strings that don't parse still work as plain text. */
public class Uri {
    private final String s;
    private final URI u;

    private Uri(String s) {
        this.s = s;
        URI parsed;
        try { parsed = new URI(s); } catch (Exception e) { parsed = null; }
        u = parsed;
    }

    public static Uri parse(String s) { return new Uri(s); }
    public static String encode(String s) { return java.net.URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20"); }

    public String getScheme() { return u == null ? null : u.getScheme(); }
    public String getHost() { return u == null ? null : u.getHost(); }
    public int getPort() { return u == null ? -1 : u.getPort(); }
    public String getAuthority() { return u == null ? null : u.getAuthority(); }
    public String getPath() { return u == null ? null : u.getPath(); }
    public String getEncodedPath() { return u == null ? null : u.getRawPath(); }
    public String getQuery() { return u == null ? null : u.getQuery(); }
    public String getEncodedQuery() { return u == null ? null : u.getRawQuery(); }
    public String getFragment() { return u == null ? null : u.getFragment(); }

    public List<String> getPathSegments() {
        List<String> out = new ArrayList<>();
        String p = getPath();
        if (p != null) for (String seg : p.split("/")) if (!seg.isEmpty()) out.add(seg);
        return out;
    }

    public String getLastPathSegment() {
        List<String> segs = getPathSegments();
        return segs.isEmpty() ? null : segs.get(segs.size() - 1);
    }

    public String getQueryParameter(String key) {
        String q = getEncodedQuery();
        if (q == null) return null;
        for (String pair : q.split("&")) {
            int eq = pair.indexOf('=');
            String k = URLDecoder.decode(eq < 0 ? pair : pair.substring(0, eq), StandardCharsets.UTF_8);
            if (k.equals(key)) return eq < 0 ? "" : URLDecoder.decode(pair.substring(eq + 1), StandardCharsets.UTF_8);
        }
        return null;
    }

    @Override public String toString() { return s; }
    @Override public boolean equals(Object o) { return o instanceof Uri other && other.s.equals(s); }
    @Override public int hashCode() { return s.hashCode(); }
    public Builder buildUpon() { return new Builder(s); }

    /** Builds on the string form, appending encoded path segments and query parameters. */
    public static final class Builder {
        private String scheme, authority, path = "", query, fragment;
        public Builder() {}
        Builder(String uri) {
            Uri u = Uri.parse(uri);
            if (u.u == null) { path = uri; return; }
            scheme = u.u.getScheme();
            authority = u.u.getRawAuthority();
            path = u.u.getRawPath() == null ? "" : u.u.getRawPath();
            query = u.u.getRawQuery();
            fragment = u.u.getRawFragment();
        }
        public Builder scheme(String s) { scheme = s; return this; }
        public Builder authority(String a) { authority = a; return this; }
        public Builder encodedAuthority(String a) { authority = a; return this; }
        public Builder path(String p) { path = p == null ? "" : p.replace(" ", "%20"); return this; }
        public Builder encodedPath(String p) { path = p == null ? "" : p; return this; }
        public Builder appendPath(String segment) { return appendEncodedPath(encode(segment)); }
        public Builder appendEncodedPath(String segment) {
            path = (path.endsWith("/") ? path : path + "/") + (segment.startsWith("/") ? segment.substring(1) : segment);
            return this;
        }
        public Builder appendQueryParameter(String key, String value) {
            String pair = encode(key) + "=" + encode(value == null ? "" : value);
            query = query == null || query.isEmpty() ? pair : query + "&" + pair;
            return this;
        }
        public Builder encodedQuery(String q) { query = q; return this; }
        public Builder query(String q) { query = q; return this; }
        public Builder clearQuery() { query = null; return this; }
        public Builder fragment(String f) { fragment = f; return this; }
        public Uri build() {
            StringBuilder b = new StringBuilder();
            if (scheme != null) b.append(scheme).append(':');
            if (authority != null) b.append("//").append(authority);
            if (authority != null && !path.isEmpty() && !path.startsWith("/")) b.append('/');
            b.append(path);
            if (query != null) b.append('?').append(query);
            if (fragment != null) b.append('#').append(fragment);
            return Uri.parse(b.toString());
        }
        @Override public String toString() { return build().toString(); }
    }
}
