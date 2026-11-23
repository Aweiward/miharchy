package android.os;

/** Reports a recent Android release, which extensions put in user agents and feature checks. */
public class Build {
    public static final String MODEL = "Pixel 9", MANUFACTURER = "Google", BRAND = "google", PRODUCT = "tokay", DEVICE = "tokay";
    public static final String ID = "BP2A.250605.031", DISPLAY = ID, TYPE = "user", TAGS = "release-keys", HARDWARE = "tokay";
    public static final String FINGERPRINT = "google/tokay/tokay:16/" + ID + "/13578290:user/release-keys";
    public static final String[] SUPPORTED_ABIS = { "arm64-v8a" };
    public static class VERSION {
        public static final String RELEASE = "16";
        public static final int SDK_INT = 36;
    }
}
