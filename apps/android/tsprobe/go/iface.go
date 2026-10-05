package tsprobe

import (
	"errors"
	"net"

	"tailscale.com/net/netmon"
)

// Android refuses app UIDs the netlink route socket, and Tailscale's androidbin fallback is compiled out of
// cgo Android builds, which are expected to register their own getter as Tailscale's Android app does from
// Java. This registers androidbin's synthetic interface: the source addresses the kernel picks for outbound
// UDP sockets, which send no packets.
func init() {
	netmon.RegisterInterfaceGetter(func() ([]netmon.Interface, error) {
		var addrs []net.Addr
		for _, probe := range [][2]string{{"udp4", "8.8.8.8:53"}, {"udp6", "[2001:4860:4860::8888]:53"}} {
			c, err := net.Dial(probe[0], probe[1])
			if err != nil {
				continue
			}
			if ua, ok := c.LocalAddr().(*net.UDPAddr); ok && !ua.IP.IsLoopback() && !ua.IP.IsUnspecified() {
				bits := 32
				if ua.IP.To4() == nil {
					bits = 128
				}
				addrs = append(addrs, &net.IPNet{IP: ua.IP, Mask: net.CIDRMask(bits, bits)})
			}
			c.Close()
		}
		if len(addrs) == 0 {
			return nil, errors.New("no outbound routes")
		}
		return []netmon.Interface{{Interface: &net.Interface{MTU: 1500, Name: "android", Flags: net.FlagUp | net.FlagRunning}, AltAddrs: addrs}}, nil
	})
}
