package android.util;

import java.util.regex.Pattern;

public final class Patterns {
    public static final Pattern EMAIL_ADDRESS = Pattern.compile(
        "[a-zA-Z0-9\\+\\.\\_\\%\\-\\+]{1,256}\\@[a-zA-Z0-9][a-zA-Z0-9\\-]{0,64}(\\.[a-zA-Z0-9][a-zA-Z0-9\\-]{0,25})+");
    public static final Pattern WEB_URL = Pattern.compile("(?i)\\b(?:https?://|www\\.)[^\\s<>\"]+");
    public static final Pattern DOMAIN_NAME = Pattern.compile("(?i)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}");
}
