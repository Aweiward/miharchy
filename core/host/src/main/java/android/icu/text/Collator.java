package android.icu.text;

import java.util.Locale;

/** java.text.Collator under ICU's names. Strength and decomposition numbers match. */
public abstract class Collator implements java.util.Comparator<Object> {
    public static final int PRIMARY = 0, SECONDARY = 1, TERTIARY = 2, QUATERNARY = 3, IDENTICAL = 15;
    public static final int NO_DECOMPOSITION = 16, CANONICAL_DECOMPOSITION = 17;
    final java.text.Collator base;
    Collator(java.text.Collator base) { this.base = base; }
    public static Collator getInstance() { return getInstance(Locale.getDefault()); }
    public static Collator getInstance(Locale locale) { return new RuleBasedCollator(java.text.Collator.getInstance(locale)); }
    public void setStrength(int strength) { base.setStrength(strength == IDENTICAL ? java.text.Collator.IDENTICAL : Math.min(strength, 2)); }
    public int getStrength() { return base.getStrength(); }
    public void setDecomposition(int d) { base.setDecomposition(d == NO_DECOMPOSITION ? java.text.Collator.NO_DECOMPOSITION : java.text.Collator.CANONICAL_DECOMPOSITION); }
    public int compare(String a, String b) { return base.compare(a, b); }
    @Override public int compare(Object a, Object b) { return base.compare(a.toString(), b.toString()); }
    public boolean equals(String a, String b) { return base.equals(a, b); }
    public Collator freeze() { return this; }
}
