import test from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'

test('LAN collaboration CRDT converges after concurrent edits and keeps Unicode intact', () => {
  const host = new Y.Doc()
  const guest = new Y.Doc()
  const hostText = host.getText('content')
  const guestText = guest.getText('content')
  hostText.insert(0, '标题 😀\n')
  Y.applyUpdate(guest, Y.encodeStateAsUpdate(host))

  const hostBroadcasts = []
  const guestBroadcasts = []
  host.on('update', (update) => hostBroadcasts.push(update))
  guest.on('update', (update) => guestBroadcasts.push(update))
  hostText.insert(hostText.length, '来自甲')
  guestText.insert(guestText.length, '来自乙')

  // Exchange the missing updates, as the RTCDataChannel state-vector handshake does.
  Y.applyUpdate(host, Y.encodeStateAsUpdate(guest, Y.encodeStateVector(host)))
  Y.applyUpdate(guest, Y.encodeStateAsUpdate(host, Y.encodeStateVector(guest)))

  assert.equal(hostText.toString(), guestText.toString())
  assert.match(hostText.toString(), /来自甲/)
  assert.match(hostText.toString(), /来自乙/)
  assert.match(hostText.toString(), /😀/)
  assert.ok(hostBroadcasts.length > 0 && guestBroadcasts.length > 0)
  host.destroy()
  guest.destroy()
})
