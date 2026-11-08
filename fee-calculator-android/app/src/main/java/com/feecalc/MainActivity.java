package com.feecalc;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.NumberFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class MainActivity extends Activity {

    /** A processor rate: percent of the charge plus a fixed fee, both editable. */
    static final class Rate {
        final String id, processor, name;
        final double defPercent, defFixed;
        double percent, fixed;
        TextView rateView, mainView, subView;

        Rate(String id, String processor, String name, double percent, double fixed) {
            this.id = id; this.processor = processor; this.name = name;
            this.defPercent = percent; this.defFixed = fixed;
            this.percent = percent; this.fixed = fixed;
        }

        /** Fee in cents for a charge in cents, rounded half-up to the cent. */
        long feeCents(long chargeCents) {
            if (chargeCents <= 0) return 0;
            BigDecimal fee = BigDecimal.valueOf(chargeCents)
                    .multiply(BigDecimal.valueOf(percent)).divide(BigDecimal.valueOf(100))
                    .add(BigDecimal.valueOf(fixed).multiply(BigDecimal.valueOf(100)));
            return fee.setScale(0, RoundingMode.HALF_UP).longValue();
        }

        /** Smallest charge (cents) that leaves at least {@code netCents} after fees. */
        long chargeForNet(long netCents) {
            if (netCents <= 0) return 0;
            double p = percent / 100.0;
            if (p >= 1) return -1;
            long c = (long) Math.floor((netCents + fixed * 100) / (1 - p)) - 2;
            if (c < netCents) c = netCents;
            while (c - feeCents(c) < netCents) c++;
            return c;
        }
    }

    // Standard US rates (Nov 2026). Every rate is editable in the app.
    private final List<Rate> rates = new ArrayList<>();
    {
        rates.add(new Rate("sq_inperson", "Square", "In person (tap, dip, swipe)", 2.6, 0.15));
        rates.add(new Rate("sq_online", "Square", "Online / invoice (Free plan)", 3.3, 0.30));
        rates.add(new Rate("sq_online_plus", "Square", "Online / invoice (Plus/Premium)", 2.9, 0.30));
        rates.add(new Rate("sq_keyed", "Square", "Keyed in / card on file", 3.5, 0.15));
        rates.add(new Rate("st_online", "Stripe", "Online card", 2.9, 0.30));
        rates.add(new Rate("st_intl", "Stripe", "Online, international card", 4.4, 0.30));
        rates.add(new Rate("st_manual", "Stripe", "Manually entered card", 3.4, 0.30));
        rates.add(new Rate("st_terminal", "Stripe", "In person (Terminal reader)", 2.7, 0.05));
        rates.add(new Rate("st_tap", "Stripe", "In person (Tap to Pay on phone)", 2.7, 0.15));
    }

    private static final int GREEN = Color.rgb(0x2E, 0x9E, 0x6A);
    private static final int RED = Color.rgb(0xD9, 0x53, 0x4F);
    private static final int MUTED = Color.rgb(0x88, 0x88, 0x88);

    private final NumberFormat money = NumberFormat.getCurrencyInstance(Locale.US);
    private SharedPreferences prefs;
    private EditText amountInput;
    private TextView amountLabel;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("rates", MODE_PRIVATE);
        for (Rate r : rates) {
            r.percent = prefs.getFloat(r.id + "_p", (float) r.defPercent);
            r.fixed = prefs.getFloat(r.id + "_f", (float) r.defFixed);
        }

        ScrollView scroll = new ScrollView(this);
        scroll.setFitsSystemWindows(true);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(16);
        root.setPadding(pad, pad, pad, pad * 2);
        scroll.addView(root);

        TextView title = text("Fee Calculator", 26, true);
        root.addView(title);
        TextView subtitle = text("Square & Stripe processing fees", 14, false);
        subtitle.setTextColor(MUTED);
        root.addView(subtitle);

        amountLabel = text("", 14, false);
        amountLabel.setTextColor(MUTED);
        amountLabel.setText("Amount you want to end up with");
        LinearLayout.LayoutParams alp = matchWrap();
        alp.topMargin = dp(16);
        root.addView(amountLabel, alp);

        amountInput = new EditText(this);
        amountInput.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        amountInput.setHint("$0.00");
        amountInput.setTextSize(TypedValue.COMPLEX_UNIT_SP, 32);
        amountInput.setTypeface(Typeface.DEFAULT_BOLD);
        amountInput.setText(prefs.getString("amount", "100"));
        amountInput.setSelection(amountInput.getText().length());
        root.addView(amountInput, matchWrap());
        amountInput.addTextChangedListener(new TextWatcher() {
            public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            public void onTextChanged(CharSequence s, int a, int b, int c) {}
            public void afterTextChanged(Editable s) {
                prefs.edit().putString("amount", s.toString()).apply();
                recalc();
            }
        });

        String lastProcessor = null;
        for (Rate r : rates) {
            if (!r.processor.equals(lastProcessor)) {
                lastProcessor = r.processor;
                TextView h = text(r.processor, 20, true);
                LinearLayout.LayoutParams hlp = matchWrap();
                hlp.topMargin = dp(20);
                hlp.bottomMargin = dp(4);
                root.addView(h, hlp);
            }
            root.addView(buildRow(r), rowParams());
        }

        TextView note = text("Standard US rates as of Nov 2026. Tap any row to edit its "
                + "rate if your account or plan is different. Fees are rounded to the "
                + "nearest cent; actual fees can vary (e.g. custom pricing, disputes, "
                + "currency conversion +1% on Stripe).", 12, false);
        note.setTextColor(MUTED);
        LinearLayout.LayoutParams nlp = matchWrap();
        nlp.topMargin = dp(20);
        root.addView(note, nlp);

        setContentView(scroll);
        recalc();
    }

    private View buildRow(Rate r) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(14), dp(12), dp(14), dp(12));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(12));
        bg.setStroke(dp(1), Color.argb(0x55, 0x88, 0x88, 0x88));
        bg.setColor(Color.argb(0x14, 0x88, 0x88, 0x88));
        row.setBackground(bg);

        LinearLayout left = new LinearLayout(this);
        left.setOrientation(LinearLayout.VERTICAL);
        left.addView(text(r.name, 15, true));
        r.rateView = text("", 13, false);
        r.rateView.setTextColor(MUTED);
        left.addView(r.rateView);
        row.addView(left, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        LinearLayout right = new LinearLayout(this);
        right.setOrientation(LinearLayout.VERTICAL);
        right.setGravity(Gravity.END);
        r.mainView = text("", 18, true);
        r.mainView.setGravity(Gravity.END);
        r.subView = text("", 13, false);
        r.subView.setGravity(Gravity.END);
        right.addView(r.mainView);
        right.addView(r.subView);
        row.addView(right);

        row.setOnClickListener(v -> editRate(r));
        return row;
    }

    private long parseCents() {
        String s = amountInput.getText().toString().replaceAll("[^0-9.]", "");
        if (s.isEmpty() || s.equals(".")) return 0;
        try {
            return new BigDecimal(s).multiply(BigDecimal.valueOf(100))
                    .setScale(0, RoundingMode.HALF_UP).longValue();
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private void recalc() {
        long amt = parseCents();
        for (Rate r : rates) {
            r.rateView.setText(fmtPct(r.percent) + "% + " + money.format(r.fixed));
            long exact = r.chargeForNet(amt);
            if (exact < 0) {
                r.mainView.setText("\u2014");
                r.subView.setText("");
                continue;
            }
            // Round the charge up to the next whole dollar.
            long charge = (exact + 99) / 100 * 100;
            long fee = r.feeCents(charge);
            r.mainView.setText("Charge " + fmt(charge));
            r.mainView.setTextColor(GREEN);
            r.subView.setText("Fee " + fmt(fee) + " \u00b7 you get " + fmt(charge - fee));
            r.subView.setTextColor(MUTED);
        }
    }

    private void editRate(Rate r) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(20), dp(8), dp(20), 0);
        box.addView(text("Percent (%)", 13, false));
        EditText pct = new EditText(this);
        pct.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        pct.setText(fmtPct(r.percent));
        box.addView(pct);
        box.addView(text("Fixed fee per transaction ($)", 13, false));
        EditText fixed = new EditText(this);
        fixed.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        fixed.setText(String.format(Locale.US, "%.2f", r.fixed));
        box.addView(fixed);

        new AlertDialog.Builder(this)
                .setTitle(r.processor + " – " + r.name)
                .setView(box)
                .setPositiveButton("Save", (d, w) -> {
                    r.percent = parseDouble(pct.getText().toString(), r.percent);
                    r.fixed = parseDouble(fixed.getText().toString(), r.fixed);
                    saveRate(r);
                })
                .setNeutralButton("Reset to default", (d, w) -> {
                    r.percent = r.defPercent;
                    r.fixed = r.defFixed;
                    saveRate(r);
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void saveRate(Rate r) {
        prefs.edit().putFloat(r.id + "_p", (float) r.percent)
                .putFloat(r.id + "_f", (float) r.fixed).apply();
        recalc();
    }

    private static double parseDouble(String s, double fallback) {
        try {
            double v = Double.parseDouble(s.trim());
            return (v >= 0 && v < 100) ? v : fallback;
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private String fmt(long cents) {
        return money.format(cents / 100.0);
    }

    private static String fmtPct(double p) {
        // Floats from prefs can carry noise (2.5999999); round to 3 places.
        BigDecimal bd = BigDecimal.valueOf(p).setScale(3, RoundingMode.HALF_UP).stripTrailingZeros();
        return bd.toPlainString();
    }

    private TextView text(String s, int sp, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams rowParams() {
        LinearLayout.LayoutParams lp = matchWrap();
        lp.bottomMargin = dp(8);
        return lp;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
