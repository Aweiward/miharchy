package android.os;

/** Hands results to onReceiveResult, on the given Handler's thread if there is one. */
public class ResultReceiver implements Parcelable {
    private final Handler handler;
    public ResultReceiver(Handler handler) { this.handler = handler; }
    public void send(int resultCode, Bundle resultData) {
        if (handler != null) handler.post(() -> onReceiveResult(resultCode, resultData));
        else onReceiveResult(resultCode, resultData);
    }
    protected void onReceiveResult(int resultCode, Bundle resultData) {}
}
