package android.icu.text;

/** Case level and numeric ordering have no java.text switch, so they're accepted and ignored. */
public final class RuleBasedCollator extends Collator {
    RuleBasedCollator(java.text.Collator base) { super(base); }
    public void setCaseLevel(boolean on) {}
    public void setNumericCollation(boolean on) {}
    @Override public Collator freeze() { return this; }
}
