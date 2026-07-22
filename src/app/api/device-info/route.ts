import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    // Get client IP from various sources
    const ip = 
      request.headers.get('x-forwarded-for')?.split(',')[0] ||
      request.headers.get('x-real-ip') ||
      request.headers.get('cf-connecting-ip') ||
      request.ip ||
      'Unknown'

    // Try to get geolocation from IP using a free service
    let location = { country: 'Unknown', city: 'Unknown', timezone: 'Unknown' }
    try {
      const geoResponse = await fetch(`https://ipapi.co/${ip.trim()}/json/`, { 
        next: { revalidate: 3600 } 
      })
      if (geoResponse.ok) {
        const geoData = await geoResponse.json()
        location = {
          country: geoData.country_name || 'Unknown',
          city: geoData.city || 'Unknown',
          timezone: geoData.timezone || 'Unknown'
        }
      }
    } catch (error) {
      console.error('Failed to fetch geolocation:', error)
      // Continue without geolocation data
    }

    return NextResponse.json({
      ip: ip.trim(),
      location,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Failed to get device info:', error)
    return NextResponse.json({ 
      ip: 'Unknown',
      location: { country: 'Unknown', city: 'Unknown', timezone: 'Unknown' },
      timestamp: new Date().toISOString(),
    })
  }
}
