package android.icu.text;

import java.text.Normalizer;
import java.util.Locale;

public abstract class Normalizer2 {
    public abstract String normalize(CharSequence src);

    private static Normalizer2 of(Normalizer.Form form, boolean fold) {
        return new Normalizer2() {
            @Override public String normalize(CharSequence src) {
                String s = Normalizer.normalize(src, form);
                return fold ? Normalizer.normalize(s.toLowerCase(Locale.ROOT), form) : s;
            }
        };
    }

    public static Normalizer2 getNFCInstance() { return of(Normalizer.Form.NFC, false); }
    public static Normalizer2 getNFDInstance() { return of(Normalizer.Form.NFD, false); }
    public static Normalizer2 getNFKCInstance() { return of(Normalizer.Form.NFKC, false); }
    public static Normalizer2 getNFKDInstance() { return of(Normalizer.Form.NFKD, false); }
    /** Lower-casing stands in for ICU's case folding, which matches it outside a few special letters. */
    public static Normalizer2 getNFKCCasefoldInstance() { return of(Normalizer.Form.NFKC, true); }
}
