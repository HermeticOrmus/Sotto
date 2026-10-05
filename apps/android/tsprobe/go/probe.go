// Package tsprobe is spike code: an embedded Tailscale node for the Android probe app. Never merged.
package tsprobe

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"os"
	"sort"
	"time"

	_ "tailscale.com/feature/androidbin"
	"tailscale.com/net/netmon"
	"tailscale.com/tsnet"
	"tailscale.com/util/eventbus"
)

var srv *tsnet.Server

// Start brings up a node with state in dir and no auth key, so it must log in through a browser.
func Start(dir, hostname string) error {
	// Android apps have no home folder for Tailscale's log state, and Sotto uploads no logs: keep both local.
	os.Setenv("TS_NO_LOGS_NO_SUPPORT", "true")
	os.Setenv("TS_LOGS_DIR", dir)
	srv = &tsnet.Server{Dir: dir, Hostname: hostname, Logf: func(string, ...any) {}}
	return srv.Start()
}

// Status is JSON: backend state, login URL, own IPs and every peer.
func Status() string {
	lc, err := srv.LocalClient()
	if err != nil {
		return fmt.Sprintf(`{"error":%q}`, err.Error())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	st, err := lc.Status(ctx)
	if err != nil {
		return fmt.Sprintf(`{"error":%q}`, err.Error())
	}
	type peer struct {
		Name   string `json:"name"`
		DNS    string `json:"dns"`
		Online bool   `json:"online"`
	}
	out := struct {
		State string   `json:"state"`
		Auth  string   `json:"authURL"`
		IPs   []string `json:"ips"`
		Peers []peer   `json:"peers"`
	}{State: st.BackendState, Auth: st.AuthURL}
	for _, ip := range st.TailscaleIPs {
		out.IPs = append(out.IPs, ip.String())
	}
	for _, p := range st.Peer {
		out.Peers = append(out.Peers, peer{p.HostName, p.DNSName, p.Online})
	}
	sort.Slice(out.Peers, func(i, j int) bool { return out.Peers[i].Name < out.Peers[j].Name })
	b, _ := json.Marshal(out)
	return string(b)
}

// Forward listens on a loopback port and pipes each connection to target (host:port) through the node.
func Forward(target string) (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
				r, err := srv.Dial(ctx, "tcp", target)
				cancel()
				if err != nil {
					return
				}
				defer r.Close()
				go io.Copy(r, c)
				io.Copy(c, r)
			}(c)
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port, nil
}

// Diag calls each interface lookup on tsnet's start path by itself and reports which one fails.
func Diag() string {
	var lines []string
	add := func(name string, err error) {
		if err != nil {
			lines = append(lines, name+": "+err.Error())
		} else {
			lines = append(lines, name+": ok")
		}
	}
	_, err := net.Interfaces()
	add("net.Interfaces", err)
	_, err = net.InterfaceAddrs()
	add("net.InterfaceAddrs", err)
	il, err := netmon.GetInterfaceList()
	add(fmt.Sprintf("netmon.GetInterfaceList (%d)", len(il)), err)
	_, err = netmon.DefaultRouteInterface()
	add("netmon.DefaultRouteInterface", err)
	m, err := netmon.New(eventbus.New(), func(string, ...any) {})
	add("netmon.New", err)
	if m != nil {
		m.Close()
	}
	b, _ := json.Marshal(lines)
	return string(b)
}
