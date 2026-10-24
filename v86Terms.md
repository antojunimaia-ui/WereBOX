# v86 Terms and Usage Guidelines for WereBOX

## Important Clarifications

This document clarifies the terms of use and modification of the v86 emulator within the WereBOX project.

---

## What We **CANNOT** Do

### ❌ Upstream Contributions Prohibited

The v86 project **does not accept**:
- Pull Requests (PRs)
- Issues
- Feature requests
- Bug reports
- Code contributions

**Why?** The v86 maintainers have explicitly stated they do not want AI-generated contributions or external PRs. This is their policy and we respect it.

---

## What We **CAN** Do

### ✅ Local Modifications Allowed

The v86 library is licensed under **BSD-2-Clause**, which permits:

1. **Use** - We can use v86 as a library in WereBOX
2. **Modification** - We can modify the v86 source code locally
3. **Distribution** - We can distribute our modified version
4. **Private forks** - We can maintain our own fork with custom patches

### ✅ Practical Applications

We are **free to**:

- **Modify `libv86.js` and `v86.wasm`** directly in the WereBOX project
- **Fix bugs** that affect WereBOX functionality
- **Add features** specific to WereBOX needs
- **Optimize performance** for our use cases
- **Patch issues** without waiting for upstream releases
- **Customize behavior** to better integrate with our interface
- **Maintain a private fork** with our own improvements
- **Add support for modern systems** (ReactOS, Windows 95/98/2000) by improving hardware emulation (ACPI, PCI, etc.)

---

## Our Approach

### Strategy

1. **Use v86 as a dependency** via npm (`v86` package)
2. **Apply local patches** when needed for WereBOX-specific features
3. **Document modifications** in this repository
4. **Keep track of v86 version** we're based on
5. **Do NOT submit changes upstream** - they won't be accepted

### Independence

This approach gives us:
- ✅ **Full control** over the emulation layer
- ✅ **Fast iteration** - no waiting for upstream approval
- ✅ **Custom features** - tailored to WereBOX needs
- ✅ **Bug fixes** - immediate resolution without dependencies
- ✅ **Optimization** - tuned for our specific workloads

---

## License Compliance

### v86 License: BSD-2-Clause

**Requirements we must follow:**

1. ✅ **Preserve copyright notice** - The v86 copyright is in `node_modules/v86/LICENSE`
2. ✅ **Preserve license text** - We maintain the original BSD-2-Clause license
3. ✅ **No endorsement** - We don't claim v86 authors endorse WereBOX

**What the license allows:**

- ✅ Commercial use
- ✅ Modification
- ✅ Distribution
- ✅ Private use
- ✅ No obligation to share modifications

### WereBOX License

The WereBOX interface and customizations are our own work:
- `ui/` - Our own code
- Interface logic - Our implementation
- FAT driver - Written from scratch
- Mobile keyboard - Our implementation
- Duo mode - Our design
- Styling and theming - Our CSS

---

## Version Tracking

### Current v86 Version

- **Package**: `v86@0.5.471` (from npm)
- **Files**: `libv86.js`, `v86.wasm`, `seabios.bin`, `vgabios.bin`
- **Source**: https://github.com/copy/v86

### Modifications Log

When we modify v86 locally, we document changes here:

| Date | File | Change | Reason |
|------|------|--------|--------|
| _TBD_ | _TBD_ | _TBD_ | _TBD_ |

*(No modifications yet - using stock v86 from npm)*

---

## Best Practices

### When to Modify v86

Consider modifying v86 when:
- 🐛 Critical bug affects WereBOX and upstream won't fix it
- 🚀 Performance optimization is needed for our use case
- ✨ Feature is required specifically for WereBOX
- 🔧 Integration with our interface requires v86 changes

### When NOT to Modify v86

Avoid modifications when:
- ⚠️ The change is purely cosmetic
- ⚠️ The issue can be worked around in our interface code
- ⚠️ The modification would break compatibility with standard systems
- ⚠️ The change is too invasive and maintenance burden is high

### Documentation Requirements

If we modify v86:
1. Document the change in this file's "Modifications Log"
2. Add comments in the modified code explaining why
3. Keep the original v86 version tagged for reference
4. Test thoroughly to ensure systems still boot correctly

---

## Summary

**TL;DR:**
- ❌ Don't submit PRs/issues to v86 upstream
- ✅ Feel free to modify v86 locally for WereBOX
- ✅ We have full freedom under BSD-2-Clause license
- ✅ Keep modifications documented
- ✅ Respect upstream's policy of no external contributions

This gives us the **best of both worlds**: we benefit from v86's excellent x86 emulation while maintaining full control over our implementation.

---


*Last updated: 2026-10-24*