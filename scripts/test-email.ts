import nodemailer from 'nodemailer'

async function testBrevoEmail() {
  const transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    auth: {
      user: 'b0bbe0001@smtp-brevo.com',
      pass: 'xsmtpsib-a9257d9fa321b37aeb3a277e053c7765912b034d44fd81cd7442adde43beebdc-fsANbg0eKOEj2cz6',
    },
  })

  try {
    const info = await transporter.sendMail({
      from: '"Ebenezar POS" <b0bbe0001@smtp-brevo.com>',
      to: 'test@example.com',
      subject: 'Brevo SMTP Test - Ebenezar POS',
      html: '<h1>Test Email</h1><p>Brevo SMTP is working!</p>',
    })
    console.log('✅ Email sent successfully!')
    console.log('Message ID:', info.messageId)
    console.log('Response:', info.response)
  } catch (error) {
    console.error('❌ Failed to send email:')
    console.error(error)
  } finally {
    transporter.close()
  }
}

testBrevoEmail()
