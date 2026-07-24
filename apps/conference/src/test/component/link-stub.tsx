import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';

interface LinkStubProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
> {
  readonly href: string;
  readonly children?: ReactNode;
}

const LinkStub = forwardRef<HTMLAnchorElement, LinkStubProps>(
  ({ href, children, ...props }, ref) => (
    <a href={href} ref={ref} {...props}>
      {children}
    </a>
  ),
);

LinkStub.displayName = 'LinkStub';

export default LinkStub;
