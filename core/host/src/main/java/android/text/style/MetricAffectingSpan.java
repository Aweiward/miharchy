package android.text.style;

public abstract class MetricAffectingSpan extends CharacterStyle {
    public abstract void updateMeasureState(android.text.TextPaint textPaint);
}
