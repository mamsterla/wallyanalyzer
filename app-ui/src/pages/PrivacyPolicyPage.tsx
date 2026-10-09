import { Box, Container, Divider, Paper, Stack, Typography } from '@mui/material';

const sections = [
  {
    title: 'Information Wally stores',
    body: [
      'We store the registration information needed to provide your account, including your email address and any profile information you choose to provide. We also store the equipment and system details you enter to configure reports.',
      'We store audio files you upload or capture through an assigned PSIU, the reports created from those files, and the related report settings and provenance needed to provide, reproduce, and support the analysis.',
      'We do not use advertising trackers or sell personal information.',
    ],
  },
  {
    title: 'How we use information',
    body: [
      'We use account information to authenticate you, manage your account, assign PSIU hardware, provide support, and protect the service.',
      'We use uploaded audio, equipment details, and report settings only to create, deliver, secure, and support your requested analysis.',
    ],
  },
  {
    title: 'Sharing and service providers',
    body: [
      'We do not sell or rent personal information. We use service providers to host, secure, and operate Wally. They may process information only as needed to provide those services for Wally.',
      'We may disclose information when required by law, to protect rights or safety, or to investigate security or service abuse.',
    ],
  },
  {
    title: 'Retention and deletion',
    body: [
      'We retain account information, audio, and report artifacts while your account is active or as needed to provide the service. You may request access to, correction of, or deletion of your account information and uploaded audio.',
      'To make a request, email privacy@wally-analytics.app from the email address associated with your account. We may verify your identity before acting. We will delete eligible information upon request, subject to legal, security, fraud-prevention, and recordkeeping obligations.',
    ],
  },
  {
    title: 'Security',
    body: [
      'We use access controls and private cloud storage designed to protect account information, audio, and reports. No internet transmission or storage system is completely secure.',
    ],
  },
  {
    title: 'Changes and contact',
    body: [
      'We may update this policy as Wally changes. The current version will remain available at this URL.',
      'Questions or privacy requests: privacy@wally-analytics.app.',
    ],
  },
];

export function PrivacyPolicyPage() {
  return (
    <Container maxWidth="md">
      <Paper sx={{ p: { xs: 3, sm: 5 } }}>
        <Stack spacing={3}>
          <Box>
            <Typography component="h1" variant="h3" gutterBottom>
              Privacy Policy
            </Typography>
            <Typography color="text.secondary">Effective October 8, 2026</Typography>
          </Box>
          <Typography>
            This policy explains how Wally Analyzer handles account information and audio submitted for analysis.
          </Typography>
          {sections.map((section) => (
            <Box component="section" key={section.title}>
              <Divider sx={{ mb: 3 }} />
              <Typography component="h2" variant="h5" gutterBottom>
                {section.title}
              </Typography>
              <Stack spacing={1.5}>
                {section.body.map((paragraph) => (
                  <Typography key={paragraph}>{paragraph}</Typography>
                ))}
              </Stack>
            </Box>
          ))}
        </Stack>
      </Paper>
    </Container>
  );
}
