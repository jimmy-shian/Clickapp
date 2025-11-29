package com.jimmyshian.click;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class FileSaveActivity extends Activity {

    private static final String TAG = "FileSaveActivity";
    private static final int REQ_CREATE_FILE = 2001;

    private String pendingContent;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String fileName = getIntent().getStringExtra("fileName");
        pendingContent = getIntent().getStringExtra("content");

        if (fileName == null || fileName.trim().isEmpty()) {
            fileName = "script.json";
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);

        startActivityForResult(intent, REQ_CREATE_FILE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQ_CREATE_FILE && resultCode == RESULT_OK && data != null && pendingContent != null) {
            Uri uri = data.getData();
            if (uri != null) {
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out != null) {
                        out.write(pendingContent.getBytes(StandardCharsets.UTF_8));
                        out.flush();
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Failed to write file", e);
                }
            }
        }

        finish();
    }
}
