import { Bonjour } from 'bonjour-service'
import getLogger from './Log.js'

const log = getLogger('mdns')
let instance: Bonjour | null = null

function publish (port: number, urlPath: string) {
  instance = new Bonjour()

  instance.publish({
    name: 'Karaoke Eternal',
    type: 'karaoke-eternal',
    port,
    txt: { path: urlPath },
  })

  log.info('mDNS service published on port %d', port)
}

function unpublish () {
  if (instance) {
    instance.unpublishAll()
    instance.destroy()
    instance = null
    log.info('mDNS service unpublished')
  }
}

export default { publish, unpublish }
