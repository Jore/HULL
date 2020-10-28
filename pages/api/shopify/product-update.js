import sanityClient from '@sanity/client'
import crypto from 'crypto'

const options = {
  dataset: process.env.SANITY_PROJECT_DATASET,
  projectId: process.env.SANITY_PROJECT_ID,
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
}

const sanity = sanityClient(options)

export default async function send(req, res) {
  // extract shopify data
  const {
    body: { id, title, handle, variants },
  } = req

  console.log('starting Shopify sync...')

  // bail if it's not a post request or it's missing an ID
  if (req.method !== 'POST' || !req.body) {
    console.log('must be a POST request with a product ID')
    return res
      .status(200)
      .json({ error: 'must be a POST request with a product ID' })
  }

  // get request integrity header
  const hmac = req.headers['x-shopify-hmac-sha256']
  const generatedHash = await crypto
    .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_INTEGRITY)
    .update(JSON.stringify(req.body, null, 2), 'utf8', 'hex')
    .digest('base64')

  console.log(`header value: ${hmac}`)
  console.log(`local hash: ${generatedHash}`)

  // bail if shopify integrity doesn't match
  if (hmac !== generatedHash) {
    console.log('not verified from Shopify')
    return res.status(200).json({ error: 'not verified from Shopify' })
  }

  let stx = sanity.transaction()

  // setup product document
  const product = {
    _type: 'product',
    _id: `product.${id}`,
  }

  // define produt fields
  const productFields = {
    productTitle: title,
    productID: id,
    variantID: variants[0].id,
    price: variants[0].price,
    sku: variants[0].sku,
  }

  // create product if doesn't exist
  stx = stx.createIfNotExists(product)

  // patch (update) product document with core shopify data
  stx = stx.patch(`product.${id}`, (patch) => patch.set(productFields))
  // patch (update) slug if none has been set
  stx = stx.patch(`product.${id}`, (patch) =>
    patch.setIfMissing({ slug: { current: handle } })
  )

  // define productVariant documents
  const productVariants = variants.map((variant) => ({
    _type: 'productVariant',
    _id: `productVariant.${variant.id}`,
  }))

  // define productVariant fields
  const productVariantFields = variants.map((variant) => ({
    variantTitle: variant.title,
    productID: id,
    variantID: variant.id,
    price: variant.price,
    sku: variant.sku,
  }))

  // create variant if doesn't exist & patch (update) variant with core shopify data
  productVariants.forEach((variant, i) => {
    stx = stx.createIfNotExists(variant)
    stx = stx.patch(variant._id, (patch) => patch.set(productVariantFields[i]))
  })

  const result = await stx.commit()

  console.log('sync complete!')

  res.statusCode = 200
  res.json(JSON.stringify(result))
}

// export const config = {
//   api: {
//     bodyParser: false,
//   },
// }