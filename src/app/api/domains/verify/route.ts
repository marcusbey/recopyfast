import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { 
  createDomainVerification, 
  validateDomain, 
  performDomainVerification,
  generateDNSTXTRecord,
  generateFileVerificationContent
} from '@/lib/security/domain-verification';
import { validateAndSanitizeInput } from '@/lib/security/content-sanitizer';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { siteId, domain, method } = body;

    // Validate and sanitize inputs
    const sanitizedSiteId = validateAndSanitizeInput(siteId);
    const sanitizedDomain = validateAndSanitizeInput(domain);
    const sanitizedMethod = validateAndSanitizeInput(method);

    if (!sanitizedSiteId || !sanitizedDomain || !sanitizedMethod) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (!['dns', 'file'].includes(sanitizedMethod)) {
      return NextResponse.json({ error: 'Invalid verification method' }, { status: 400 });
    }

    // Validate domain format
    const domainValidation = validateDomain(sanitizedDomain);
    if (!domainValidation.isValid) {
      return NextResponse.json({ error: domainValidation.error }, { status: 400 });
    }

    // Check if user has permission to manage this site
    const { data: sitePermission, error: permissionError } = await supabase
      .from('site_permissions')
      .select('permission')
      .eq('site_id', sanitizedSiteId)
      .eq('user_id', session.user.id)
      .single();

    if (permissionError || !sitePermission || sitePermission.permission !== 'admin') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Check if verification already exists and is still valid
    const { data: existingVerification } = await supabase
      .from('domain_verifications')
      .select('*')
      .eq('site_id', sanitizedSiteId)
      .eq('domain', sanitizedDomain)
      .single();

    if (existingVerification && new Date(existingVerification.expires_at) > new Date()) {
      // Return existing verification if still valid
      const verificationInstructions = sanitizedMethod === 'dns' 
        ? { type: 'dns', record: generateDNSTXTRecord(existingVerification.verification_code) }
        : { type: 'file', ...generateFileVerificationContent(existingVerification.verification_code) };

      return NextResponse.json({
        verification: existingVerification,
        instructions: verificationInstructions
      });
    }

    // Create new domain verification
    const verification = createDomainVerification(sanitizedSiteId, sanitizedDomain, sanitizedMethod as 'dns' | 'file');

    // Insert into database
    const { data: newVerification, error: insertError } = await supabase
      .from('domain_verifications')
      .insert([verification])
      .select()
      .single();

    if (insertError) {
      console.error('Domain verification creation error:', insertError);
      return NextResponse.json({ error: 'Failed to create verification' }, { status: 500 });
    }

    // Generate verification instructions
    const verificationInstructions = sanitizedMethod === 'dns' 
      ? { type: 'dns', record: generateDNSTXTRecord(verification.verificationCode) }
      : { type: 'file', ...generateFileVerificationContent(verification.verificationCode) };

    return NextResponse.json({
      verification: newVerification,
      instructions: verificationInstructions
    });

  } catch (error) {
    console.error('Domain verification API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { verificationId } = body;

    const sanitizedVerificationId = validateAndSanitizeInput(verificationId);
    if (!sanitizedVerificationId) {
      return NextResponse.json({ error: 'Missing verification ID' }, { status: 400 });
    }

    // Get verification record with permission check
    const { data: verification, error: verificationError } = await supabase
      .from('domain_verifications')
      .select(`
        *,
        sites!inner(
          id,
          site_permissions!inner(
            permission,
            user_id
          )
        )
      `)
      .eq('id', sanitizedVerificationId)
      .eq('sites.site_permissions.user_id', session.user.id)
      .eq('sites.site_permissions.permission', 'admin')
      .single();

    if (verificationError || !verification) {
      return NextResponse.json({ error: 'Verification not found or access denied' }, { status: 404 });
    }

    // Check if verification has expired
    if (new Date(verification.expires_at) <= new Date()) {
      return NextResponse.json({ error: 'Verification has expired' }, { status: 400 });
    }

    // Perform the actual verification
    const verificationResult = await performDomainVerification(verification);

    if (verificationResult.success) {
      // Update verification status
      const { error: updateError } = await supabase
        .from('domain_verifications')
        .update({ 
          is_verified: true, 
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', sanitizedVerificationId);

      if (updateError) {
        console.error('Verification update error:', updateError);
        return NextResponse.json({ error: 'Failed to update verification status' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: 'Domain verification successful',
        verifiedAt: new Date().toISOString()
      });
    } else {
      return NextResponse.json({
        success: false,
        error: verificationResult.error,
        details: verificationResult.details
      }, { status: 400 });
    }

  } catch (error) {
    console.error('Domain verification check API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get('siteId');

    if (!siteId) {
      return NextResponse.json({ error: 'Missing siteId parameter' }, { status: 400 });
    }

    const sanitizedSiteId = validateAndSanitizeInput(siteId);

    // Get all verifications for the site with permission check
    const { data: verifications, error } = await supabase
      .from('domain_verifications')
      .select(`
        *,
        sites!inner(
          id,
          domain,
          site_permissions!inner(
            permission,
            user_id
          )
        )
      `)
      .eq('site_id', sanitizedSiteId)
      .eq('sites.site_permissions.user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Domain verifications fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch verifications' }, { status: 500 });
    }

    return NextResponse.json({ verifications });

  } catch (error) {
    console.error('Domain verifications API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    if (authError || !session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const verificationId = searchParams.get('verificationId');

    if (!verificationId) {
      return NextResponse.json({ error: 'Missing verificationId parameter' }, { status: 400 });
    }

    const sanitizedVerificationId = validateAndSanitizeInput(verificationId);

    // Delete verification with permission check
    const { error } = await supabase
      .from('domain_verifications')
      .delete()
      .eq('id', sanitizedVerificationId)
      .eq('sites.site_permissions.user_id', session.user.id)
      .eq('sites.site_permissions.permission', 'admin');

    if (error) {
      console.error('Domain verification deletion error:', error);
      return NextResponse.json({ error: 'Failed to delete verification' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Verification deleted successfully' });

  } catch (error) {
    console.error('Domain verification deletion API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}