package com.deepdrift.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * While Deep Drift is playing, this keeps the app alive with the screen off:
 * Android leaves a foreground service with a "now playing" notification
 * running, and the wake lock stops the processor from sleeping under the
 * sound. The page stops it when the sleep timer has faded everything out,
 * and the "Stop" button in the notification stops it too.
 */
public class PlayingService extends Service {
    static final String STOP = "com.deepdrift.app.STOP";
    private static final String CHANNEL = "playing";
    private static final int ID = 1;
    // a ceiling, in case the page never says it is done
    private static final long LONGEST = 3 * 60 * 60 * 1000L;
    private PowerManager.WakeLock lock;

    static void start(Context c) {
        Intent i = new Intent(c, PlayingService.class);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, PlayingService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) {
            sendBroadcast(new Intent(STOP).setPackage(getPackageName()));   // tell the page to go quiet
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification n = notification();
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(ID, n);
        if (lock == null) {
            lock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "DeepDrift:playing");
            lock.setReferenceCounted(false);
        }
        lock.acquire(LONGEST);
        return START_NOT_STICKY;
    }

    @SuppressWarnings("deprecation")
    private Notification notification() {
        int immutable = Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), immutable);
        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, PlayingService.class).setAction(STOP), immutable);
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, getString(R.string.channel), NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ch.setSound(null, null);
            getSystemService(NotificationManager.class).createNotificationChannel(ch);
            b = new Notification.Builder(this, CHANNEL);
        } else {
            b = new Notification.Builder(this).setPriority(Notification.PRIORITY_LOW);
        }
        return b.setSmallIcon(R.drawable.ic_launcher_monochrome)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(getString(R.string.playing))
                .setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, getString(R.string.stop), stop).build())
                .setOngoing(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .build();
    }

    @Override
    public void onDestroy() {
        if (lock != null && lock.isHeld()) lock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
