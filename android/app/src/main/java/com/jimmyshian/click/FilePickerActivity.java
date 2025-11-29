package com.jimmyshian.click;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Log;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;

public class FilePickerActivity extends Activity {

    private static final String TAG = "FilePickerActivity";
    private static final int REQ_PICK_FILE = 1001;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        // 2. 修正這裡：加入 "text/*" 與 "application/octet-stream"
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
                "text/plain",            // 標準 txt
                "text/*",                // 重點修正：這能涵蓋大部分被誤判的 txt 檔
                "application/json",      // 標準 json
                "application/octet-stream" // 有些手機會把未知的文字檔視為二進位流，加這行更保險
        });
        Intent chooser = Intent.createChooser(intent, "Select JSON file");
        startActivityForResult(chooser, REQ_PICK_FILE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == REQ_PICK_FILE && resultCode == RESULT_OK && data != null) {
            Uri uri = data.getData();
            if (uri != null) {
                String slot = getIntent().getStringExtra("slot");
                String fileName = getFileName(uri);
                String content = readTextFromUri(uri);

                OmniClickAccessibilityService service = OmniClickAccessibilityService.getInstance();
                if (service != null && content != null) {
                    service.onFilePickedFromActivity(slot != null ? slot : "", fileName, content);
                } else {
                    Log.w(TAG, "Service instance is null or content is null");
                }
            }
        }

        finish();
    }

    private String readTextFromUri(Uri uri) {
        StringBuilder sb = new StringBuilder();
        try (InputStream in = getContentResolver().openInputStream(uri);
             BufferedReader reader = new BufferedReader(new InputStreamReader(in))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append('\n');
            }
        } catch (IOException e) {
            Log.e(TAG, "Failed to read file content", e);
            return null;
        }
        return sb.toString();
    }

    private String getFileName(Uri uri) {
        String result = null;
        Cursor cursor = null;
        try {
            cursor = getContentResolver().query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index != -1) {
                    result = cursor.getString(index);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to query file name", e);
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }

        if (result == null) {
            result = uri.getLastPathSegment();
        }
        return result != null ? result : "selected.json";
    }
}
