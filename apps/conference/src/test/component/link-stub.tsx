import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from 'react';

interface LinkStubProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
> {
  readonly href: string;
  readonly children?: ReactNode;
  readonly prefetch?: boolean | null;
}

const LinkStub = forwardRef<HTMLAnchorElement, LinkStubProps>(
  ({ href, children, prefetch, ...props }, ref) => {
    void prefetch;
    return (
      <a href={href} ref={ref} {...props}>
        {children}
      </a>
    );
  },
);

LinkStub.displayName = 'LinkStub';

export default LinkStub;
