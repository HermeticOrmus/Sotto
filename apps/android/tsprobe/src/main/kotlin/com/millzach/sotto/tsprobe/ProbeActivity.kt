package com.millzach.sotto.tsprobe

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketAddress
import java.util.concurrent.TimeUnit
import javax.net.SocketFactory
import kotlin.concurrent.thread

// Spike probe: start an embedded node, show its login URL and peers, and fetch Sun's echo directly and through it.
class ProbeActivity : Activity() {
    private lateinit var out: TextView
    private val target = "https://sun.tailb43a3a.ts.net/"
    private var started = false

    private fun say(line: String) { Log.i("TSPROBE", line); runOnUiThread { out.append(line + "\n\n") } }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        out = TextView(this).apply { setTextIsSelectable(true); textSize = 13f }
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24, 360, 24, 200) }
        fun button(label: String, action: () -> Unit) = column.addView(Button(this).apply { text = label; setOnClickListener { thread { try { action() } catch (e: Throwable) { say("$label failed: $e") } } } })
        button("0. Diagnose interface lookups") { say("diag: " + tsprobe.Tsprobe.diag()) }
        button("1. Control: GET without the node") { say("control: " + get(OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build(), "control")) }
        button("2. Start node (fresh state, no key)") { start() }
        button("3. Status and peers") { status() }
        button("4. Open login URL") { val url = JSONObject(tsprobe.Tsprobe.status()).optString("authURL"); if (url.isEmpty()) say("no login URL yet") else startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        button("5. GET through the node") { viaNode() }
        column.addView(out)
        setContentView(ScrollView(this).apply { addView(column) })
    }

    private fun start() {
        if (started) { say("already started"); return }
        val dir = File(filesDir, "tsnet-" + System.currentTimeMillis()).apply { mkdirs() }
        val host = "sotto-probe-" + Build.MODEL.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')
        say("starting $host in fresh dir ${dir.name}")
        tsprobe.Tsprobe.start(dir.absolutePath, host)
        started = true
        repeat(20) { Thread.sleep(1000); val s = JSONObject(tsprobe.Tsprobe.status()); if (s.optString("authURL").isNotEmpty() || s.optString("state") == "Running") { say("state ${s.optString("state")} login URL: ${s.optString("authURL")}"); return } }
        say("no login URL after 20 s: " + tsprobe.Tsprobe.status())
    }

    private fun status() {
        val s = JSONObject(tsprobe.Tsprobe.status())
        val peers = s.optJSONArray("peers")
        val names = (0 until (peers?.length() ?: 0)).map { peers!!.getJSONObject(it).getString("name") }
        say("state ${s.optString("state")} own IPs ${s.optJSONArray("ips")} peers ${names.size}: ${names.joinToString()} fera=${"fera" in names} mars-1=${names.any { it == "mars" || it == "mars-1" }}")
    }

    private fun viaNode() {
        val port = tsprobe.Tsprobe.forward("sun.tailb43a3a.ts.net:443").toInt()
        // Every connection goes to the node's loopback forwarder; TLS still verifies sun.tailb43a3a.ts.net.
        val sockets = object : SocketFactory() {
            override fun createSocket() = object : Socket() { override fun connect(e: SocketAddress, t: Int) = super.connect(InetSocketAddress("127.0.0.1", port), t) }
            override fun createSocket(h: String, p: Int) = throw UnsupportedOperationException()
            override fun createSocket(h: String, p: Int, l: InetAddress, lp: Int) = throw UnsupportedOperationException()
            override fun createSocket(h: InetAddress, p: Int) = throw UnsupportedOperationException()
            override fun createSocket(h: InetAddress, p: Int, l: InetAddress, lp: Int) = throw UnsupportedOperationException()
        }
        val client = OkHttpClient.Builder().socketFactory(sockets).dns(object : okhttp3.Dns { override fun lookup(hostname: String) = listOf(InetAddress.getLoopbackAddress()) }).callTimeout(30, TimeUnit.SECONDS).build()
        say("via node: " + get(client, "via-node"))
    }

    private fun get(client: OkHttpClient, path: String): String =
        try { client.newCall(Request.Builder().url(target + path).build()).execute().use { "${it.code} ${it.body?.string()}" } } catch (e: Exception) { "error $e" }
}
